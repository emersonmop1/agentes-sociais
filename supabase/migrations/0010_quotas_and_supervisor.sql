-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0010 — quota enforcement helpers + content supervisor support.
--
-- Adds:
--   • fn_decrement_quota(company_id, kind) — atomic, returns remaining or NULL
--     when the quota was already 0. Callers turn NULL into a 429.
--   • fn_reset_expired_quotas() — sets remaining back to plan defaults for any
--     company whose quota_resets_at <= now(). Called by a daily cron.
--   • trigram index on creator_posts.title to speed up the content supervisor's
--     similarity check against the last 500 titles.
--
-- The supervisor itself lives in TypeScript (apps/api/src/services/
-- content-supervisor.ts) — picking a unique angle is judgment work that needs
-- the LLM, not SQL. The DB only provides the corpus + a fast filter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── fn_decrement_quota ────────────────────────────────────────────────────
-- Subtract 1 from the named quota column. Returns the new remaining value, or
-- NULL when the quota was already exhausted (in which case nothing is written).
-- Uses a single UPDATE with a RETURNING clause so it's atomic without an
-- explicit transaction — safe under concurrency.
CREATE OR REPLACE FUNCTION public.fn_decrement_quota(
  p_company_id UUID,
  p_kind TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining INTEGER;
BEGIN
  CASE p_kind
    WHEN 'posts' THEN
      UPDATE public.companies
         SET posts_quota_remaining = posts_quota_remaining - 1,
             updated_at = now()
       WHERE id = p_company_id
         AND posts_quota_remaining > 0
       RETURNING posts_quota_remaining INTO v_remaining;
    WHEN 'reels' THEN
      UPDATE public.companies
         SET reels_quota_remaining = reels_quota_remaining - 1,
             updated_at = now()
       WHERE id = p_company_id
         AND reels_quota_remaining > 0
       RETURNING reels_quota_remaining INTO v_remaining;
    WHEN 'youtube' THEN
      UPDATE public.companies
         SET youtube_projects_quota_remaining = youtube_projects_quota_remaining - 1,
             updated_at = now()
       WHERE id = p_company_id
         AND youtube_projects_quota_remaining > 0
       RETURNING youtube_projects_quota_remaining INTO v_remaining;
    WHEN 'chat' THEN
      UPDATE public.companies
         SET chat_messages_quota_remaining = chat_messages_quota_remaining - 1,
             updated_at = now()
       WHERE id = p_company_id
         AND chat_messages_quota_remaining > 0
       RETURNING chat_messages_quota_remaining INTO v_remaining;
    ELSE
      RAISE EXCEPTION 'unknown quota kind: %', p_kind;
  END CASE;

  RETURN v_remaining;  -- NULL => quota was already 0, nothing was decremented
END;
$$;

-- ─── fn_reset_expired_quotas ───────────────────────────────────────────────
-- Resets quotas for any company whose window has elapsed. Defaults match the
-- column DEFAULTs in 0001 — keep these in sync if plan tiers diverge later.
CREATE OR REPLACE FUNCTION public.fn_reset_expired_quotas()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.companies
       SET posts_quota_remaining = CASE plan
             WHEN 'pro' THEN 500
             ELSE 50
           END,
           reels_quota_remaining = CASE plan
             WHEN 'pro' THEN 100
             ELSE 10
           END,
           youtube_projects_quota_remaining = CASE plan
             WHEN 'pro' THEN 50
             ELSE 5
           END,
           chat_messages_quota_remaining = CASE plan
             WHEN 'pro' THEN 5000
             ELSE 200
           END,
           quota_resets_at = now() + INTERVAL '30 days',
           updated_at = now()
     WHERE quota_resets_at <= now()
     RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_affected FROM updated;
  RETURN v_affected;
END;
$$;

-- ─── content supervisor index ─────────────────────────────────────────────
-- The supervisor pulls the last N titles for a company and asks the LLM for an
-- unused angle. We don't need a trigram index for the read itself (it's a
-- bounded LIMIT 500 with company_id filter that already has an index from
-- 0004), but adding one lets future "is this title too similar to anything we
-- have?" checks land cheaply when we want them.
CREATE INDEX IF NOT EXISTS idx_creator_posts_title_trgm
  ON public.creator_posts USING GIN (title gin_trgm_ops);
