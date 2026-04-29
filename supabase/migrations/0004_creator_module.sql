-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0004 — Insta Creator pipeline (carousel posts).
--
-- Mirror of final.md §4 (Schema). Tables:
--   • creator_posts        — 1 row per carousel/single, 14 status enum
--   • creator_image_cache  — 7-day TTL cache of image search results
--   • creator_render_jobs  — Playwright render queue
--   • creator_publish_jobs — Graph API publish queue with retry
--
-- State machine lives in the API (apps/api/src/core/creator-state-machine.ts).
-- Status field uses an ENUM so DB rejects invalid values. Forward transitions
-- are enforced application-side because rejecting backwards (review→draft) is
-- valid and depends on rejection_feedback context.
--
-- visual_style enum was already created in 0002 — we reuse it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enums ─────────────────────────────────────────────────────────────────
CREATE TYPE public.creator_post_status AS ENUM (
  'draft',
  'copy_review',     'copy_approved',
  'design_review',   'design_approved',
  'caption_review',  'caption_approved',
  'final_review',
  'ready',           'scheduled',
  'publishing',      'published',
  'publish_failed',  'rejected'
);

CREATE TYPE public.creator_post_type AS ENUM ('carousel', 'single');

CREATE TYPE public.creator_render_status AS ENUM (
  'pending', 'running', 'completed', 'failed'
);

CREATE TYPE public.creator_publish_status AS ENUM (
  'queued', 'validating', 'uploading', 'publishing',
  'completed', 'failed', 'cancelled'
);

CREATE TYPE public.creator_publisher AS ENUM ('graph_api');
-- 'manus' was a clubhub option — we're skipping it for v1.

-- ─── creator_posts ─────────────────────────────────────────────────────────
CREATE TABLE public.creator_posts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Metadata
  title                       TEXT NOT NULL,
  post_type                   public.creator_post_type NOT NULL DEFAULT 'carousel',
  status                      public.creator_post_status NOT NULL DEFAULT 'draft',
  visual_style                public.visual_style NOT NULL DEFAULT 'tweet_thread',

  -- Slides (slides_config schema in final.md §4.6)
  slides_config               JSONB NOT NULL DEFAULT '[]'::jsonb,
  slides_count                INTEGER NOT NULL DEFAULT 0,

  -- Storage prefix in Supabase Storage. e.g. "{company_id}/{post_id}/"
  slides_storage_prefix       TEXT,
  cover_image_url             TEXT,

  -- Caption
  caption                     TEXT,
  first_comment               TEXT,
  hashtags                    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Research outputs (research_data: web research, sources, etc.)
  research_data               JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_urls                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Brand snapshot — frozen at create time. final.md §12 rule: never re-read brand_config
  brand_snapshot              JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Review state
  rejection_feedback          TEXT,
  revision_count              INTEGER NOT NULL DEFAULT 0,

  -- Publish
  scheduled_at                TIMESTAMPTZ,
  published_at                TIMESTAMPTZ,
  publish_error               TEXT,
  external_post_id            TEXT,
  external_post_url           TEXT,

  -- Engagement
  performance_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  performance_last_polled_at  TIMESTAMPTZ,

  -- Reference back to the chat session that produced it
  chat_session_id             UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT slides_count_max CHECK (slides_count <= 10)
);

CREATE INDEX idx_creator_posts_company_status
  ON public.creator_posts(company_id, status);

-- For the engagement poller cron (Fatia 9+) — only PUBLISHED posts.
CREATE INDEX idx_creator_posts_published
  ON public.creator_posts(performance_last_polled_at NULLS FIRST)
  WHERE status = 'published';

-- For the scheduled poster (Fatia 4+) — only SCHEDULED with future time.
CREATE INDEX idx_creator_posts_scheduled
  ON public.creator_posts(scheduled_at)
  WHERE status = 'scheduled';

CREATE TRIGGER trg_creator_posts_updated_at
  BEFORE UPDATE ON public.creator_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.creator_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY creator_posts_member_rw ON public.creator_posts
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── creator_image_cache ───────────────────────────────────────────────────
-- search_query is normalized (lowercased, trimmed) at the API layer.
-- (search_query, source) UNIQUE so dedupe is automatic.
CREATE TABLE public.creator_image_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_query TEXT NOT NULL,
  source       TEXT NOT NULL,
  results      JSONB NOT NULL,         -- ImageResult[] {url, credit, width, height, source_url}
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE (search_query, source)
);

CREATE INDEX idx_creator_image_cache_query
  ON public.creator_image_cache(LOWER(search_query));

CREATE INDEX idx_creator_image_cache_expires
  ON public.creator_image_cache(expires_at);

-- Public cache: any authenticated user benefits from another user's prior search.
-- This is fine because Unsplash/Pexels images are public.
ALTER TABLE public.creator_image_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_image_cache_read ON public.creator_image_cache
  FOR SELECT USING (auth.role() = 'authenticated');

-- ─── creator_render_jobs ───────────────────────────────────────────────────
-- One row per render request. Worker leases via SELECT ... FOR UPDATE SKIP LOCKED.
CREATE TABLE public.creator_render_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES public.creator_posts(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- NULL or empty array = render all slides; otherwise just these indexes
  slide_indexes INT[] NOT NULL DEFAULT ARRAY[]::INT[],

  status        public.creator_render_status NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  error         TEXT,

  -- URLs of rendered PNGs in Supabase Storage
  output_urls   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Worker lease (whichever worker is processing right now)
  leased_at     TIMESTAMPTZ,
  leased_by     TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_creator_render_pending
  ON public.creator_render_jobs(created_at)
  WHERE status = 'pending';

CREATE INDEX idx_creator_render_post
  ON public.creator_render_jobs(post_id);

ALTER TABLE public.creator_render_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_render_jobs_member_read ON public.creator_render_jobs
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── creator_publish_jobs ──────────────────────────────────────────────────
CREATE TABLE public.creator_publish_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES public.creator_posts(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  publisher         public.creator_publisher NOT NULL DEFAULT 'graph_api',
  scheduled_for     TIMESTAMPTZ,                    -- NULL = publish ASAP

  status            public.creator_publish_status NOT NULL DEFAULT 'queued',
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  error             TEXT,

  -- Raw API response from Graph
  external_response JSONB,

  -- Worker lease
  leased_at         TIMESTAMPTZ,
  leased_by         TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_creator_publish_due
  ON public.creator_publish_jobs(scheduled_for NULLS FIRST)
  WHERE status = 'queued';

CREATE INDEX idx_creator_publish_post
  ON public.creator_publish_jobs(post_id);

ALTER TABLE public.creator_publish_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_publish_jobs_member_read ON public.creator_publish_jobs
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── Helper: lease the next pending render job ─────────────────────────────
-- Used by the worker. SKIP LOCKED guarantees multiple workers don't grab the same job.
CREATE OR REPLACE FUNCTION public.fn_lease_next_render_job(p_worker_id TEXT)
RETURNS public.creator_render_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.creator_render_jobs;
BEGIN
  UPDATE public.creator_render_jobs
     SET status     = 'running',
         attempts   = attempts + 1,
         leased_at  = now(),
         leased_by  = p_worker_id,
         started_at = COALESCE(started_at, now())
   WHERE id = (
     SELECT id FROM public.creator_render_jobs
      WHERE status = 'pending'
        AND (attempts < max_attempts)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING * INTO job;

  RETURN job;
END;
$$;
