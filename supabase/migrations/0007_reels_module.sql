-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0007 — reels_scripts (Reels/TikTok agent output).
--
-- Single table per script. The agent owns the conversation; this table is
-- the persistence layer for what's been agreed upon. Lifecycle:
--
--   draft → hooks_review → script_review → caption_review → broll_review → ready
--
-- Each review state lets the user approve (forward) or reject (back to draft
-- with rejection_feedback). "ready" is terminal — at that point the user can
-- export the PDF and shoot the Reel.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.reels_script_status AS ENUM (
  'draft',
  'hooks_review',
  'hook_picked',
  'script_review',
  'script_approved',
  'caption_review',
  'caption_approved',
  'broll_review',
  'ready',
  'rejected'
);

CREATE TABLE public.reels_scripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  status          public.reels_script_status NOT NULL DEFAULT 'draft',
  title           TEXT NOT NULL,
  theme           TEXT,
  /* Target duration in seconds. Common values: 15, 30, 60, 90.  */
  target_duration INTEGER NOT NULL DEFAULT 30,

  /* Hook stage outputs */
  hook_options    JSONB NOT NULL DEFAULT '[]'::jsonb,    -- Array<{angle, hook, why}>
  chosen_hook     TEXT,

  /* Script stage outputs.
     beats: Array<{
       index: number,
       start_seconds: number,
       end_seconds: number,
       visual: string,           // what the camera shows
       on_camera_speech: string, // talking head voice-over
       on_screen_text: string,   // text overlay
       broll_hint: string        // optional B-roll reference
     }>                                                                   */
  beats           JSONB NOT NULL DEFAULT '[]'::jsonb,

  /* Caption stage outputs */
  caption         TEXT,
  cta             TEXT,
  hashtags        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  /* B-roll + production stage outputs */
  broll_suggestions  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  voice_over_script  TEXT,
  edit_notes         TEXT,

  rejection_feedback TEXT,
  revision_count     INTEGER NOT NULL DEFAULT 0,

  /* Reference back to the chat session that produced this script. */
  chat_session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reels_scripts_company_status
  ON public.reels_scripts(company_id, status);

CREATE TRIGGER trg_reels_scripts_updated_at
  BEFORE UPDATE ON public.reels_scripts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.reels_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY reels_scripts_member_rw ON public.reels_scripts
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );
