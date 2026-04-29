-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0005 — integration_tokens (encrypted OAuth state per company).
--
-- One row per (company, provider). Holds:
--   • access_token_encrypted: AES-256-GCM ciphertext (server decrypts before
--     calling the provider)
--   • refresh_token_encrypted: same, when provider returns one
--   • metadata: provider-specific public details (channel id, page id, etc.)
--
-- The encryption key lives in env (ENCRYPTION_KEY, 32-byte hex). DB never
-- sees plaintext. The service role bypasses RLS to read these — RLS is a
-- secondary defense, not the primary one.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.integration_provider AS ENUM (
  'instagram_graph',
  'youtube',
  'google_drive'
);

CREATE TABLE public.integration_tokens (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider                    public.integration_provider NOT NULL,

  -- Encrypted at rest (AES-256-GCM, format: base64(iv ‖ ciphertext ‖ tag))
  access_token_encrypted      TEXT NOT NULL,
  refresh_token_encrypted     TEXT,

  /* Provider-specific public data:
       • Instagram Graph: { ig_user_id, ig_username, fb_page_id, fb_page_name }
       • YouTube:         { channel_id, channel_title }
       • Drive:           { account_email }                                 */
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,

  /* Timestamps for token lifecycle. Long-lived FB tokens last 60 days, so
     we proactively refresh before that. Set to NULL for tokens that don't
     expire (offline access). */
  expires_at                  TIMESTAMPTZ,
  refreshed_at                TIMESTAMPTZ,

  /* Marked invalid when the API rejects the token (revoked / expired etc.).
     Frontend uses this to surface a "reconnect" CTA. */
  invalid                     BOOLEAN NOT NULL DEFAULT false,
  invalid_reason              TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (company_id, provider)
);

CREATE INDEX idx_integration_tokens_company
  ON public.integration_tokens(company_id);

CREATE TRIGGER trg_integration_tokens_updated_at
  BEFORE UPDATE ON public.integration_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_tokens_member_read ON public.integration_tokens
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );
-- Inserts/updates always go through the service role (server side), so no
-- write policy. RLS just prevents reads from leaking to other tenants.

-- ─── OAuth state CSRF protection ────────────────────────────────────────────
-- Short-lived nonce stored in DB during the redirect dance. We could keep
-- this in a signed cookie too, but DB-backed state survives redirects across
-- different browsers on the same SSO flow (rare but real).
CREATE TABLE public.oauth_state (
  state           TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider        public.integration_provider NOT NULL,
  return_to       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes')
);

CREATE INDEX idx_oauth_state_expiry ON public.oauth_state(expires_at);
