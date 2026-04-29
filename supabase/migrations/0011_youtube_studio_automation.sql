-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0011 — YouTube Studio Automation (pinned comment).
--
-- Studio actions can't be done via the public Data API — we drive a real
-- browser session with cookies the user provides. v2 will add end-screen
-- editing and A/B title testing; for now we automate just the pinned comment
-- because:
--   • Pinning a comment is the highest-value action (steers conversation,
--     promotes upsells, surfaces creator context)
--   • The youtube.com/watch UI is stable enough for Playwright selectors
--   • End-screen editor lives behind a Studio iframe + drag-drop UI that is
--     brittle and would dominate the engineering budget
--
-- Schema:
--   • youtube_studio_sessions: 1 row per company. Holds the encrypted cookie
--     bundle the worker hydrates into Playwright. No FK to a user — the cookies
--     belong to the company even if a different user uploaded them.
--   • youtube_studio_jobs: queue. Worker leases via fn_lease_next_youtube_
--     studio_job, mirrors the pattern from publish/render queues.
--   • youtube_projects gains studio_status + studio_error + studio_completed_at
--     so the UI can show "Aplicando…" / "Aplicado" / "Falhou" inline with
--     the existing publish status.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── youtube_studio_sessions ──────────────────────────────────────────────
CREATE TABLE public.youtube_studio_sessions (
  company_id          UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Encrypted JSON array of Playwright cookies (AES-256-GCM via lib/crypto.ts).
  -- Format expected: [{ name, value, domain, path, expires?, httpOnly?, secure?, sameSite? }]
  cookies_encrypted   TEXT NOT NULL,
  /* Optional self-reported expiry — earliest cookie expiration the user gave us.
     Worker uses this to surface "reconnect needed" before a job actually fails. */
  expires_at          TIMESTAMPTZ,
  /* When the worker last successfully used these cookies (for a heartbeat). */
  last_validated_at   TIMESTAMPTZ,
  /* If a worker job hits 401/redirect-to-login, mark these invalid + reason. */
  invalid             BOOLEAN NOT NULL DEFAULT false,
  invalid_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_youtube_studio_sessions_updated_at
  BEFORE UPDATE ON public.youtube_studio_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ─── youtube_studio_jobs ──────────────────────────────────────────────────
CREATE TYPE public.youtube_studio_job_kind AS ENUM ('pin_comment');
CREATE TYPE public.youtube_studio_job_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

CREATE TABLE public.youtube_studio_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES public.youtube_projects(id) ON DELETE CASCADE,
  kind            public.youtube_studio_job_kind NOT NULL,
  status          public.youtube_studio_job_status NOT NULL DEFAULT 'queued',
  /* Inputs captured at enqueue time so a delayed run uses the right values
     even if the project's pinned_comment_text has been edited since. */
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  /* Outputs (e.g. studio comment id, screenshot ref) populated by handler. */
  result          JSONB NOT NULL DEFAULT '{}'::jsonb,

  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  error           TEXT,

  /* Lease (mirrors render / publish queues) */
  leased_at       TIMESTAMPTZ,
  leased_by       TEXT,
  lease_expires_at TIMESTAMPTZ,

  scheduled_for   TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_studio_jobs_status_scheduled
  ON public.youtube_studio_jobs(status, COALESCE(scheduled_for, created_at));

CREATE INDEX idx_youtube_studio_jobs_project
  ON public.youtube_studio_jobs(project_id);

CREATE TRIGGER trg_youtube_studio_jobs_updated_at
  BEFORE UPDATE ON public.youtube_studio_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ─── youtube_projects column additions ───────────────────────────────────
ALTER TABLE public.youtube_projects
  ADD COLUMN studio_status        TEXT
    CHECK (studio_status IN ('not_requested','queued','running','completed','failed')),
  ADD COLUMN studio_error         TEXT,
  ADD COLUMN studio_completed_at  TIMESTAMPTZ;

UPDATE public.youtube_projects SET studio_status = 'not_requested';

-- ─── fn_lease_next_youtube_studio_job ────────────────────────────────────
-- Same pattern as fn_lease_next_publish_job: SELECT … FOR UPDATE SKIP LOCKED,
-- swap to running, set lease window. Worker resets to queued on transient
-- failures so the lease eventually expires and the next worker picks it up.
CREATE OR REPLACE FUNCTION public.fn_lease_next_youtube_studio_job(
  p_worker_id TEXT
)
RETURNS public.youtube_studio_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.youtube_studio_jobs;
BEGIN
  SELECT *
    INTO job
    FROM public.youtube_studio_jobs
   WHERE status = 'queued'
     AND (scheduled_for IS NULL OR scheduled_for <= now())
     AND attempts < max_attempts
   ORDER BY COALESCE(scheduled_for, created_at) ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF job.id IS NULL THEN
    RETURN job;
  END IF;

  UPDATE public.youtube_studio_jobs
     SET status = 'running'::public.youtube_studio_job_status,
         attempts = attempts + 1,
         leased_at = now(),
         leased_by = p_worker_id,
         lease_expires_at = now() + INTERVAL '5 minutes',
         updated_at = now()
   WHERE id = job.id
   RETURNING * INTO job;

  RETURN job;
END;
$$;
