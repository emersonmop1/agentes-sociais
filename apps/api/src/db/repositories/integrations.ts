import { exec, one, oneOrThrow, type Queryable } from "../client.js";

export type IntegrationProvider = "instagram_graph" | "youtube" | "google_drive";

export interface IntegrationTokenRow {
  id: string;
  company_id: string;
  provider: IntegrationProvider;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  refreshed_at: string | null;
  invalid: boolean;
  invalid_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertTokenArgs {
  companyId: string;
  provider: IntegrationProvider;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
}

export async function upsertToken(
  q: Queryable | undefined,
  args: UpsertTokenArgs,
): Promise<IntegrationTokenRow> {
  return oneOrThrow<IntegrationTokenRow>(
    q,
    `INSERT INTO public.integration_tokens
       (company_id, provider, access_token_encrypted, refresh_token_encrypted, metadata, expires_at, refreshed_at, invalid, invalid_reason)
     VALUES ($1, $2::public.integration_provider, $3, $4, $5::jsonb, $6, now(), false, NULL)
     ON CONFLICT (company_id, provider) DO UPDATE
       SET access_token_encrypted  = EXCLUDED.access_token_encrypted,
           refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
           metadata                = EXCLUDED.metadata,
           expires_at              = EXCLUDED.expires_at,
           refreshed_at            = now(),
           invalid                 = false,
           invalid_reason          = NULL,
           updated_at              = now()
     RETURNING *`,
    [
      args.companyId,
      args.provider,
      args.accessTokenEncrypted,
      args.refreshTokenEncrypted ?? null,
      JSON.stringify(args.metadata ?? {}),
      args.expiresAt?.toISOString() ?? null,
    ],
  );
}

export async function getToken(
  q: Queryable | undefined,
  companyId: string,
  provider: IntegrationProvider,
): Promise<IntegrationTokenRow | null> {
  return one<IntegrationTokenRow>(
    q,
    `SELECT * FROM public.integration_tokens
      WHERE company_id = $1 AND provider = $2::public.integration_provider`,
    [companyId, provider],
  );
}

export async function markTokenInvalid(
  q: Queryable | undefined,
  args: { companyId: string; provider: IntegrationProvider; reason: string },
): Promise<void> {
  await exec(
    q,
    `UPDATE public.integration_tokens
        SET invalid = true,
            invalid_reason = $3,
            updated_at = now()
      WHERE company_id = $1
        AND provider = $2::public.integration_provider`,
    [args.companyId, args.provider, args.reason.slice(0, 1000)],
  );
}

export async function deleteToken(
  q: Queryable | undefined,
  companyId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.integration_tokens
      WHERE company_id = $1 AND provider = $2::public.integration_provider`,
    [companyId, provider],
  );
}

// ─── oauth_state ─────────────────────────────────────────────────────────

export interface OAuthStateRow {
  state: string;
  user_id: string;
  company_id: string;
  provider: IntegrationProvider;
  return_to: string | null;
  created_at: string;
  expires_at: string;
}

export async function createOAuthState(
  q: Queryable | undefined,
  args: {
    state: string;
    userId: string;
    companyId: string;
    provider: IntegrationProvider;
    returnTo?: string;
  },
): Promise<void> {
  await exec(
    q,
    `INSERT INTO public.oauth_state (state, user_id, company_id, provider, return_to)
     VALUES ($1, $2, $3, $4::public.integration_provider, $5)`,
    [
      args.state,
      args.userId,
      args.companyId,
      args.provider,
      args.returnTo ?? null,
    ],
  );
}

export async function consumeOAuthState(
  q: Queryable | undefined,
  state: string,
): Promise<OAuthStateRow | null> {
  return one<OAuthStateRow>(
    q,
    `DELETE FROM public.oauth_state
      WHERE state = $1 AND expires_at > now()
      RETURNING *`,
    [state],
  );
}

export async function purgeExpiredOAuthState(
  q: Queryable | undefined,
): Promise<void> {
  await exec(q, `DELETE FROM public.oauth_state WHERE expires_at <= now()`);
}
