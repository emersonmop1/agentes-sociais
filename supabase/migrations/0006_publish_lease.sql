-- Migration 0006 — lease helper for publish jobs.
-- Mirrors fn_lease_next_render_job but only returns jobs whose scheduled_for
-- is in the past or NULL. Workers call this every poll tick.

CREATE OR REPLACE FUNCTION public.fn_lease_next_publish_job(p_worker_id TEXT)
RETURNS public.creator_publish_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.creator_publish_jobs;
BEGIN
  UPDATE public.creator_publish_jobs
     SET status     = 'publishing'::public.creator_publish_status,
         attempts   = attempts + 1,
         leased_at  = now(),
         leased_by  = p_worker_id,
         started_at = COALESCE(started_at, now())
   WHERE id = (
     SELECT id FROM public.creator_publish_jobs
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
