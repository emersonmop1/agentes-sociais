-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0001 — auth, companies, profiles, members, post-signup trigger
--
-- Creates the multi-tenant foundation. Every signup auto-creates:
--   1. profiles row (mirror of auth.users)
--   2. companies row (default company, owned by signed-up user)
--   3. company_members row (owner role)
-- All subsequent tables (chat, memory, posts, etc.) FK to companies.id.
-- ─────────────────────────────────────────────────────────────────────────────

-- pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- citext for case-insensitive slug uniqueness
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── Helper: updated_at trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- 1:1 with auth.users. Holds display_name, avatar, default company.
CREATE TABLE public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        TEXT,
  avatar_url          TEXT,
  default_company_id  UUID,  -- FK added later (companies created after profile)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ─── companies ───────────────────────────────────────────────────────────────
-- 1 user → 1 company default. Team invites in v2 (company_members supports it).
CREATE TYPE public.company_plan AS ENUM ('free', 'pro');

CREATE TABLE public.companies (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                              TEXT NOT NULL,
  slug                              CITEXT NOT NULL UNIQUE,
  owner_user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                              public.company_plan NOT NULL DEFAULT 'free',

  -- Onboarding state (BrandBot fills onboarding_draft incrementally)
  onboarding_completed              BOOLEAN NOT NULL DEFAULT false,
  onboarding_draft                  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Quotas (no billing v1, but limits prevent abuse and prepare tiers)
  posts_quota_remaining             INTEGER NOT NULL DEFAULT 50,
  reels_quota_remaining             INTEGER NOT NULL DEFAULT 10,
  youtube_projects_quota_remaining  INTEGER NOT NULL DEFAULT 5,
  chat_messages_quota_remaining     INTEGER NOT NULL DEFAULT 200,
  quota_resets_at                   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),

  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_owner ON public.companies(owner_user_id);

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_company_fk
  FOREIGN KEY (default_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- ─── company_members ─────────────────────────────────────────────────────────
CREATE TYPE public.company_member_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE public.company_members (
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.company_member_role NOT NULL DEFAULT 'member',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX idx_company_members_user ON public.company_members(user_id);

-- ─── slug helper: derive unique slug from email prefix ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_unique_company_slug(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  suffix INT := 0;
BEGIN
  -- "rodolfo.mori@example.com" → "rodolfo-mori"
  base := lower(regexp_replace(split_part(p_email, '@', 1), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  IF base = '' OR base IS NULL THEN
    base := 'company';
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.companies WHERE slug = candidate::citext) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  END LOOP;
  RETURN candidate;
END;
$$;

-- ─── post-signup trigger: auto-create profile + company + member ─────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_display_name TEXT;
  v_company_name TEXT;
  v_slug TEXT;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1)
  );
  v_company_name := COALESCE(v_display_name, 'Minha empresa');
  v_slug := public.fn_unique_company_slug(NEW.email);

  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    v_display_name,
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.companies (name, slug, owner_user_id)
  VALUES (v_company_name, v_slug, NEW.id)
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (v_company_id, NEW.id, 'owner');

  UPDATE public.profiles SET default_company_id = v_company_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Defense-in-depth alongside the API auth middleware. Service role bypasses RLS.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- profiles: a user can read/update only their own profile
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- companies: a user can read/update companies they are a member of
CREATE POLICY companies_member_read ON public.companies
  FOR SELECT USING (
    id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );
CREATE POLICY companies_owner_update ON public.companies
  FOR UPDATE USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- company_members: visible to fellow members of the same company
CREATE POLICY company_members_self ON public.company_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

-- ─── Storage buckets (public read, signed write) ─────────────────────────────
-- These are created here so devs hitting `supabase db reset` get them.
-- In production they must also exist; the service role inserts files.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('logos',           'logos',           true),
  ('avatars',         'avatars',         true),
  ('slides',          'slides',          true),
  ('thumbs',          'thumbs',          true),
  ('creator-faces',   'creator-faces',   false),
  ('generated-images','generated-images',true)
ON CONFLICT (id) DO NOTHING;
