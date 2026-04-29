/**
 * Google OAuth 2.0 (web flow) — used by YouTube Data API and Drive integrations.
 *
 * Flow:
 *   1. authorize URL with offline access_type → user consents → callback gets code.
 *   2. Exchange code → access_token + refresh_token.
 *   3. We store BOTH encrypted (refresh_token enables long-term offline use).
 *   4. When access_token expires (~1h), worker exchanges refresh_token → fresh access.
 *
 * Scopes (YouTube channel + upload + read analytics):
 *   • https://www.googleapis.com/auth/youtube.upload
 *   • https://www.googleapis.com/auth/youtube
 *   • https://www.googleapis.com/auth/youtube.readonly
 *   • (Drive scope added later when fatia 7 video download lands)
 */

import { loadEnv } from "../env.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export interface AuthorizeArgs {
  state: string;
  redirectUri: string;
}

export function buildAuthorizeUrl(args: AuthorizeArgs): string {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID not configured");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("access_type", "offline");
  // prompt=consent forces refresh_token even on re-auth (important — without
  // it Google may skip refresh_token on re-consent of the same scopes)
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export interface ExchangeResult {
  /** Long-lived refresh token (lasts indefinitely until revoked). */
  refreshToken: string;
  /** Short-lived access token (~1h). */
  accessToken: string;
  expiresAt: Date;
  /** YouTube channel info (best-effort fetch right after exchange). */
  channel: {
    id: string | null;
    title: string | null;
    customUrl: string | null;
    thumbnailUrl: string | null;
  };
}

export async function exchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
}): Promise<ExchangeResult> {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }

  // 1. code → tokens
  const body = new URLSearchParams({
    code: args.code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokRes.ok) {
    throw new Error(
      `Google token exchange failed (${tokRes.status}): ${(await tokRes.text()).slice(0, 200)}`,
    );
  }
  const tok = (await tokRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tok.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Likely user previously consented and refresh was issued before. " +
        "Revoke access at https://myaccount.google.com/permissions and re-connect.",
    );
  }

  // 2. Best-effort fetch the user's primary YouTube channel
  let channel = {
    id: null as string | null,
    title: null as string | null,
    customUrl: null as string | null,
    thumbnailUrl: null as string | null,
  };
  try {
    const ch = await fetchChannel(tok.access_token);
    channel = ch;
  } catch {
    // Non-critical for OAuth itself; user might not have a YouTube channel
    // associated with this Google account (rare). We still store the tokens.
  }

  return {
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    channel,
  };
}

async function fetchChannel(accessToken: string): Promise<ExchangeResult["channel"]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    throw new Error(`channels.list failed (${r.status})`);
  }
  const data = (await r.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
  };
  const item = data.items?.[0];
  return {
    id: item?.id ?? null,
    title: item?.snippet?.title ?? null,
    customUrl: item?.snippet?.customUrl ?? null,
    thumbnailUrl: item?.snippet?.thumbnails?.default?.url ?? null,
  };
}

/** Refresh the access token using the stored refresh_token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    const err = new Error(`refresh failed (${r.status}): ${txt.slice(0, 200)}`);
    (err as Error & { isAuthError?: boolean }).isAuthError =
      r.status === 400 || r.status === 401;
    throw err;
  }
  const tok = (await r.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: tok.access_token,
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
  };
}
