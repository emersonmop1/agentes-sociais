-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0002 — brand_configs + chat_sessions + chat_messages + helpers
--
-- Adds the tables needed for Fatia 1 (BrandBot conversational onboarding):
--   1. brand_configs        — final brand identity (filled at onboarding_complete)
--   2. chat_sessions        — per-company conversations with any agent
--   3. chat_messages        — individual messages (user + assistant + system)
--
-- Also seeds agent_catalog with brand-bot so the registry has an entry.
-- The onboarding flow writes to companies.onboarding_draft (already in 0001)
-- and only persists to brand_configs at /onboarding/complete.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── brand_configs ─────────────────────────────────────────────────────────
-- 1:1 with companies. Snapshot is cloned to creator_posts.brand_snapshot at
-- post creation time so old posts preserve their look even if the brand
-- changes later. The default visual style controls which carousel template
-- the InstaCreator agent uses by default.
CREATE TYPE public.visual_style AS ENUM (
  'tweet_thread',
  'dark',
  'acid_text',
  'tweet_single'
);

CREATE TABLE public.brand_configs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Identity
  brand_name               TEXT NOT NULL,
  niche                    TEXT,
  instagram_handle         TEXT,
  tiktok_handle            TEXT,
  youtube_channel          TEXT,
  logo_url                 TEXT,
  avatar_url               TEXT,
  badge_verified           BOOLEAN NOT NULL DEFAULT false,

  -- Colors (hex)
  primary_color            TEXT NOT NULL DEFAULT '#0F172A',
  secondary_color          TEXT NOT NULL DEFAULT '#22C55E',
  accent_color             TEXT NOT NULL DEFAULT '#F59E0B',
  background_color         TEXT NOT NULL DEFAULT '#FFFFFF',
  text_color               TEXT NOT NULL DEFAULT '#0F172A',

  -- Typography
  font_family_heading      TEXT NOT NULL DEFAULT 'Inter',
  font_family_body         TEXT NOT NULL DEFAULT 'Inter',

  -- Voice
  voice_tone               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  voice_examples           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  forbidden_terms          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signature_phrases        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- ICP / target audience
  icp_description          TEXT,
  target_audience          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Default visual style for InstaCreator
  default_visual_style     public.visual_style NOT NULL DEFAULT 'tweet_thread',

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_configs_company ON public.brand_configs(company_id);

CREATE TRIGGER trg_brand_configs_updated_at
  BEFORE UPDATE ON public.brand_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.brand_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_configs_member_read ON public.brand_configs
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

CREATE POLICY brand_configs_owner_write ON public.brand_configs
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM public.company_members
       WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ─── agent_catalog (seed entries we need for Fatia 1) ──────────────────────
-- Soul + system_prompt live in code (versionable). This catalog only powers
-- UI listing, gradient colors per agent, and slug → category lookups.
CREATE TYPE public.agent_category AS ENUM ('onboarding', 'social', 'copy', 'video');

CREATE TABLE public.agent_catalog (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  avatar_emoji      TEXT NOT NULL DEFAULT '🤖',
  gradient_from     TEXT NOT NULL,
  gradient_to       TEXT NOT NULL,
  category          public.agent_category NOT NULL,
  is_visible        BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.agent_catalog (slug, name, description, avatar_emoji, gradient_from, gradient_to, category, is_visible, sort_order)
VALUES
  ('brand-bot',       'BrandBot',       'Especialista em descoberta de marca via conversa', '🌱', '#22c55e', '#15803d', 'onboarding', false, 0),
  ('insta-creator',   'InstaCreator',   'Carrosséis Instagram com revisão humana etapa a etapa', '📸', '#ec4899', '#be185d', 'social',     true,  10),
  ('reels-creator',   'ReelsCreator',   'Roteiros virais para Reels e TikTok',             '🎬', '#8b5cf6', '#6d28d9', 'social',     true,  20),
  ('copy-master',     'CopyMaster',     'Copy de conversão (email, LP, WhatsApp)',         '✍️', '#3b82f6', '#1d4ed8', 'copy',       true,  30),
  ('ad-master',       'AdMaster',       'Anúncios pagos (Meta Ads, Google Ads, scripts)',  '🎯', '#f59e0b', '#b45309', 'copy',       true,  40),
  ('youtube-growth',  'YouTubeGrowth',  'Pipeline completo YouTube (transcrição → upload)','🚀', '#ef4444', '#b91c1c', 'video',      true,  50)
ON CONFLICT (slug) DO NOTHING;

-- agent_catalog is read-only public — anyone authenticated can read it.
ALTER TABLE public.agent_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_catalog_read ON public.agent_catalog FOR SELECT USING (auth.role() = 'authenticated');

-- ─── chat_sessions ────────────────────────────────────────────────────────
-- One row per (company, agent, conversation thread). The onboarding flow
-- creates a single session_type='onboarding' session per company; regular
-- chats create as many as the user starts.
CREATE TYPE public.session_type AS ENUM (
  'onboarding',
  'chat',
  'insta_creator',
  'youtube_creator',
  'reels',
  'copy',
  'ad'
);

CREATE TABLE public.chat_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_slug   TEXT NOT NULL REFERENCES public.agent_catalog(slug),
  session_type public.session_type NOT NULL DEFAULT 'chat',
  title        TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_company ON public.chat_sessions(company_id);
CREATE INDEX idx_chat_sessions_company_agent ON public.chat_sessions(company_id, agent_slug)
  WHERE archived_at IS NULL;

CREATE TRIGGER trg_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_sessions_member_rw ON public.chat_sessions
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── chat_messages ────────────────────────────────────────────────────────
CREATE TYPE public.message_role AS ENUM ('user', 'assistant', 'system');

CREATE TABLE public.chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role             public.message_role NOT NULL,
  content          TEXT NOT NULL,
  -- { input_tokens, output_tokens } from the LLM provider
  tokens_used      JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_model   TEXT,
  -- Free-form metadata: { onboarding_complete: true, attachments: [...], etc. }
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_created ON public.chat_messages(session_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_member_rw ON public.chat_messages
  FOR ALL USING (
    session_id IN (
      SELECT s.id FROM public.chat_sessions s
       JOIN public.company_members m ON m.company_id = s.company_id
      WHERE m.user_id = auth.uid()
    )
  );

-- ─── Helper: get-or-create the onboarding session ──────────────────────────
-- Called from the API on first onboarding message. Idempotent.
CREATE OR REPLACE FUNCTION public.fn_get_or_create_onboarding_session(
  p_company_id UUID,
  p_user_id    UUID
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  SELECT id INTO v_session_id
    FROM public.chat_sessions
   WHERE company_id = p_company_id
     AND agent_slug = 'brand-bot'
     AND session_type = 'onboarding'
     AND archived_at IS NULL
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_session_id IS NULL THEN
    INSERT INTO public.chat_sessions (company_id, user_id, agent_slug, session_type, title)
    VALUES (p_company_id, p_user_id, 'brand-bot', 'onboarding', 'Configurando sua marca')
    RETURNING id INTO v_session_id;
  END IF;

  RETURN v_session_id;
END;
$$;
