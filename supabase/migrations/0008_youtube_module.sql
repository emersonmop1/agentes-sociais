-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0008 — YouTube module (projects + thumbs + creator_faces).
--
-- v1 cuts:
--   • No Drive OAuth / video download yet — user pastes transcript text
--     OR uploads a video file to Storage manually (next round).
--   • Transcription happens via paste OR by passing transcript text to the
--     ideation prompt directly. Auto transcription via Gemini multimodal
--     comes in a follow-up.
--   • Studio Automation (A/B title, end screen, pinned comment) lands in
--     Fatia 8.
--
-- Status flow mirrors clubhub but with a few v1-only short-cuts:
--
--   draft → transcribing → transcribed → ideation → ideation_review →
--           generating_thumbs → thumbs_review → final_review → ready →
--           scheduled → publishing → published
--
-- The user can also reject/kill at any point.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.youtube_project_status AS ENUM (
  'draft',
  'transcribing',
  'transcribed',
  'ideation',
  'ideation_review',
  'generating_thumbs',
  'thumbs_review',
  'final_review',
  'ready',
  'scheduled',
  'publishing',
  'published',
  'publish_failed',
  'rejected',
  'failed'
);

CREATE TABLE public.youtube_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  status                   public.youtube_project_status NOT NULL DEFAULT 'draft',
  error                    TEXT,
  progress_step            TEXT,
  progress_pct             INTEGER NOT NULL DEFAULT 0,

  /* Source — v1 accepts pasted transcript OR uploaded video URL.
     drive_url / drive_file_id / local_video_path stay NULL until Drive
     integration lands. */
  drive_url                TEXT,
  drive_file_id            TEXT,
  storage_video_url        TEXT,
  video_duration_s         INTEGER,
  video_size_mb            INTEGER,

  /* Transcription */
  transcript               TEXT,
  transcript_summary       TEXT,
  /* Array<{ timestamp_seconds: number, description: string }> */
  key_moments              JSONB NOT NULL DEFAULT '[]'::jsonb,

  /* Ideation */
  title_options            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],   -- 5 candidates
  top_3_titles             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],   -- agent's picks for A/B
  chosen_title             TEXT,
  description              TEXT,
  tags                     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /* Array<{ timestamp: string, title: string }> */
  chapters                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  /* Array<{ timestamp: string, video_id?: string, title: string, url?: string }> */
  cited_videos             JSONB NOT NULL DEFAULT '[]'::jsonb,
  /* Array<{ video_id?: string, title: string, reason: string }> */
  end_screen_videos        JSONB NOT NULL DEFAULT '[]'::jsonb,

  /* Thumbnails — concepts (text) + paths to rendered PNGs */
  /* Array<{
       index: number,
       subject: string,
       hook_text: string,
       emotion: string,
       color_palette: string[],
       composition: string,
       image_prompt: string,
       use_creator_face: boolean
     }>                                                                       */
  thumbnail_concepts       JSONB NOT NULL DEFAULT '[]'::jsonb,
  /* Storage URLs aligned with concepts by index */
  thumbnail_urls           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  chosen_thumbnail_idx     INTEGER,
  use_creator_face         BOOLEAN NOT NULL DEFAULT false,
  /* Storage URLs of creator face references picked for this project */
  creator_face_refs        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  /* Publish */
  youtube_video_id         TEXT,
  youtube_url              TEXT,
  scheduled_at             TIMESTAMPTZ,
  published_at             TIMESTAMPTZ,
  publish_error            TEXT,

  /* Studio automation outcomes (Fatia 8) */
  pinned_comment_text      TEXT,
  pinned_comment_status    TEXT,
  pinned_comment_error     TEXT,

  rejection_feedback       TEXT,
  revision_count           INTEGER NOT NULL DEFAULT 0,

  chat_session_id          UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_projects_company_status
  ON public.youtube_projects(company_id, status);

CREATE TRIGGER trg_youtube_projects_updated_at
  BEFORE UPDATE ON public.youtube_projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.youtube_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY youtube_projects_member_rw ON public.youtube_projects
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── creator_faces ──────────────────────────────────────────────────────────
-- Library of creator face uploads per company. Used for thumbnail conditioning.
CREATE TABLE public.creator_faces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  storage_url   TEXT NOT NULL,
  /* Optional human-friendly label: "smile", "shock", "neutral_3q" */
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_creator_faces_company ON public.creator_faces(company_id);

ALTER TABLE public.creator_faces ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_faces_member_rw ON public.creator_faces
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── youtube_thumbnail_jobs ─────────────────────────────────────────────────
-- Worker queue specifically for thumbnail generation. Each job renders all
-- concepts of a project. Same lease pattern as render/publish.
CREATE TYPE public.youtube_thumb_job_status AS ENUM (
  'pending', 'running', 'completed', 'failed'
);

CREATE TABLE public.youtube_thumbnail_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.youtube_projects(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  /* Empty array = render all concepts; otherwise just these. */
  concept_indexes  INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  status        public.youtube_thumb_job_status NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  error         TEXT,
  output_urls   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  leased_at     TIMESTAMPTZ,
  leased_by     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_youtube_thumb_pending
  ON public.youtube_thumbnail_jobs(created_at)
  WHERE status = 'pending';

ALTER TABLE public.youtube_thumbnail_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY youtube_thumb_jobs_member_read ON public.youtube_thumbnail_jobs
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── Lease helper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lease_next_youtube_thumb_job(p_worker_id TEXT)
RETURNS public.youtube_thumbnail_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  job public.youtube_thumbnail_jobs;
BEGIN
  UPDATE public.youtube_thumbnail_jobs
     SET status     = 'running',
         attempts   = attempts + 1,
         leased_at  = now(),
         leased_by  = p_worker_id,
         started_at = COALESCE(started_at, now())
   WHERE id = (
     SELECT id FROM public.youtube_thumbnail_jobs
      WHERE status = 'pending' AND attempts < max_attempts
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING * INTO job;
  RETURN job;
END;
$$;

-- Storage bucket for thumbnails (creator-faces already created in 0001)
INSERT INTO storage.buckets (id, name, public)
VALUES ('youtube-thumbs', 'youtube-thumbs', true)
ON CONFLICT (id) DO NOTHING;
