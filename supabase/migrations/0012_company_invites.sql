-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0012 — company_invites.
--
-- The post-signup trigger from 0001 always creates a *new* company for each
-- signup. Invites give an existing company a way to add other people:
--
--   1. Owner posts to /api/companies/me/invites with email + role
--   2. Server generates a 32-byte token, stores email/role/token (hashed via
--      sha256 — we keep the token plain in the URL but only the hash in DB
--      so a DB leak doesn't grant access)
--   3. Owner shares the URL `/invite/:token` with the invitee
--   4. Invitee signs up (or signs in if already has an account), then the
--      web client posts the token to /api/invites/:token/accept
--   5. Server validates token + email match (case-insensitive), inserts
--      company_members row with the configured role, marks invite used
--
-- Email match prevents invite-link sharing: the URL is only useful to the
-- account it was issued for. Owner can revoke before acceptance.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.company_invite_status AS ENUM (
  'pending', 'accepted', 'revoked', 'expired'
);

CREATE TABLE public.company_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  /* Email is the identity check at accept time — case-insensitive comparison
     with the auth.users.email of the signed-in user. */
  email           CITEXT NOT NULL,
  role            public.company_member_role NOT NULL DEFAULT 'member',
  /* sha256 hex of the raw token. Token is shown to the user once when the
     invite is created and never persisted in plaintext. */
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status          public.company_invite_status NOT NULL DEFAULT 'pending',
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One pending invite per (company, email) — re-sending replaces the token
-- via UPSERT. Lookup by email also stays fast.
CREATE UNIQUE INDEX idx_company_invites_company_email_pending
  ON public.company_invites(company_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX idx_company_invites_status
  ON public.company_invites(status);

CREATE TRIGGER trg_company_invites_updated_at
  BEFORE UPDATE ON public.company_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

-- Owners can read invites for their company.
CREATE POLICY company_invites_owner_read ON public.company_invites
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM public.company_members
       WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
