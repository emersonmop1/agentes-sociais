-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0009 — youtube_publish_jobs (Data API upload queue) + lease helper.
--
-- Mirrors creator_publish_jobs (Insta) — a row per publish attempt, leased
-- by the worker via SKIP LOCKED, retry on transient failures, terminal
-- failure on auth issues.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.youtube_publish_status AS ENUM (
  'queued', 'uploading', 'finishing', 'completed', 'failed', 'cancelled'
);

CREATE TABLE public.youtube_publish_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.youtube_projects(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  scheduled_for     TIMESTAMPTZ,        -- NULL = ASAP
  /* Privacy of the upload. Default to private for safety; user can set to
     public via the publish endpoint body. */
  privacy_status    TEXT NOT NULL DEFAULT 'private'
    CHECK (privacy_status IN ('private', 'unlisted', 'public')),

  status            public.youtube_publish_status NOT NULL DEFAULT 'queued',
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  error             TEXT,

  /* Whatever the YouTube API returned (id, snippet, status…) */
  external_response JSONB,

  /* Worker lease */
  leased_at         TIMESTAMPTZ,
  leased_by         TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_youtube_publish_due
  ON public.youtube_publish_jobs(scheduled_for NULLS FIRST)
  WHERE status = 'queued';

CREATE INDEX idx_youtube_publish_project
  ON public.youtube_publish_jobs(project_id);

ALTER TABLE public.youtube_publish_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY youtube_publish_jobs_member_read ON public.youtube_publish_jobs
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- Lease helper: only return jobs whose scheduled_for is past or NULL.
CREATE OR REPLACE FUNCTION public.fn_lease_next_youtube_publish_job(p_worker_id TEXT)
RETURNS public.youtube_publish_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.youtube_publish_jobs;
BEGIN
  UPDATE public.youtube_publish_jobs
     SET status     = 'uploading'::public.youtube_publish_status,
         attempts   = attempts + 1,
         leased_at  = now(),
         leased_by  = p_worker_id,
         started_at = COALESCE(started_at, now())
   WHERE id = (
     SELECT id FROM public.youtube_publish_jobs
      WHERE status = 'queued'
        AND attempts < max_attempts
        AND (scheduled_for IS NULL OR scheduled_for <= now())
      ORDER BY COALESCE(scheduled_for, created_at) ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING * INTO job;
  RETURN job;
END;
$$;
