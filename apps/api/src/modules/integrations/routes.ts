/**
 * Integrations routes — `/api/integrations/*`.
 *
 * Currently only Instagram Graph (Facebook Login flow). YouTube and Drive
 * land in Fatia 7+ following the same pattern.
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { encryptString } from "../../lib/crypto.js";
import {
  consumeOAuthState,
  createOAuthState,
  deleteToken,
  getToken,
  upsertToken,
} from "../../db/repositories/integrations.js";
import {
  deleteStudioSession,
  getStudioSession,
  upsertStudioSession,
} from "../../db/repositories/youtube-studio.js";
import { z } from "zod";
import { loadEnv } from "../../env.js";
import { logger } from "../../lib/logger.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForPageToken,
} from "../../services/instagram-graph.js";
import {
  buildAuthorizeUrl as buildGoogleAuthorizeUrl,
  exchangeCodeForTokens as exchangeGoogleCode,
} from "../../services/google-oauth.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const integrationsRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

/** Public routes (no auth) — used by OAuth callbacks where the redirect
 *  comes from Facebook and won't carry our JWT. State token is the auth. */
export const integrationsPublicRoutes = new Hono();

// ─── GET /api/integrations/status ───────────────────────────────────────────
// Lists what's connected for the current company.
integrationsRoutes.get("/status", async (c) => {
  const companyId = c.var.company.companyId;
  const ig = await getToken(undefined, companyId, "instagram_graph");
  const yt = await getToken(undefined, companyId, "youtube");
  return c.json({
    instagram: ig
      ? {
          connected: !ig.invalid,
          invalid_reason: ig.invalid_reason,
          username: (ig.metadata as { ig_username?: string }).ig_username ?? null,
          ig_user_id: (ig.metadata as { ig_user_id?: string }).ig_user_id ?? null,
          fb_page_name: (ig.metadata as { fb_page_name?: string }).fb_page_name ?? null,
          connected_at: ig.refreshed_at,
        }
      : { connected: false },
    youtube: yt
      ? {
          connected: !yt.invalid,
          invalid_reason: yt.invalid_reason,
          channel_id: (yt.metadata as { channel_id?: string }).channel_id ?? null,
          channel_title: (yt.metadata as { channel_title?: string }).channel_title ?? null,
          channel_custom_url:
            (yt.metadata as { channel_custom_url?: string }).channel_custom_url ?? null,
          channel_thumbnail_url:
            (yt.metadata as { channel_thumbnail_url?: string }).channel_thumbnail_url ?? null,
          connected_at: yt.refreshed_at,
        }
      : { connected: false },
  });
});

// ─── POST /api/integrations/instagram/connect ───────────────────────────────
// Returns the Facebook authorize URL the frontend should open.
// We persist the CSRF state in DB AND a HttpOnly cookie (defense in depth).
integrationsRoutes.post("/instagram/connect", async (c) => {
  const env = loadEnv();
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    return c.json(
      {
        error: "not_configured",
        message:
          "INSTAGRAM_APP_ID/SECRET not set on server. Connect requires a Facebook Developer App.",
      },
      503,
    );
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = `${env.API_PUBLIC_URL}/api/integrations/instagram/callback`;

  await createOAuthState(undefined, {
    state,
    userId: c.var.auth.userId,
    companyId: c.var.company.companyId,
    provider: "instagram_graph",
  });

  setCookie(c, "ig_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/integrations",
    maxAge: 60 * 15,
  });

  const authorizeUrl = buildAuthorizeUrl({ state, redirectUri });
  return c.json({ authorize_url: authorizeUrl });
});

// ─── GET /api/integrations/instagram/callback ───────────────────────────────
// Facebook redirects here. We exchange code → token → store encrypted →
// redirect back to the web app's settings page.
//
// Lives on the PUBLIC router because Facebook won't carry our JWT. The state
// cookie + DB-backed state row are the identification mechanism.
integrationsPublicRoutes.get("/instagram/callback", async (c) => {
  const env = loadEnv();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  const redirectBack = (params: Record<string, string>) => {
    const u = new URL(`${env.WEB_PUBLIC_URL}/agents/insta-creator`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return c.redirect(u.toString());
  };

  if (errorParam) {
    return redirectBack({
      ig_connect: "error",
      reason: errorDescription ?? errorParam,
    });
  }
  if (!code || !state) {
    return redirectBack({ ig_connect: "error", reason: "missing_code_or_state" });
  }

  // Verify state cookie matches DB
  const cookieState = getCookie(c, "ig_oauth_state");
  if (cookieState !== state) {
    deleteCookie(c, "ig_oauth_state", { path: "/api/integrations" });
    return redirectBack({ ig_connect: "error", reason: "state_mismatch" });
  }
  deleteCookie(c, "ig_oauth_state", { path: "/api/integrations" });

  const stateRow = await consumeOAuthState(undefined, state);
  if (!stateRow) {
    return redirectBack({ ig_connect: "error", reason: "state_expired" });
  }
  if (stateRow.provider !== "instagram_graph") {
    return redirectBack({ ig_connect: "error", reason: "wrong_provider" });
  }

  const redirectUri = `${env.API_PUBLIC_URL}/api/integrations/instagram/callback`;

  let exchange;
  try {
    exchange = await exchangeCodeForPageToken({ code, redirectUri });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, companyId: stateRow.company_id },
      "ig oauth exchange failed",
    );
    return redirectBack({
      ig_connect: "error",
      reason: (err as Error).message.slice(0, 200),
    });
  }

  await upsertToken(undefined, {
    companyId: stateRow.company_id,
    provider: "instagram_graph",
    accessTokenEncrypted: encryptString(exchange.pageAccessToken),
    metadata: {
      ig_user_id: exchange.igUserId,
      ig_username: exchange.igUsername,
      fb_page_id: exchange.fbPageId,
      fb_page_name: exchange.fbPageName,
    },
    expiresAt: exchange.expiresAt,
  });

  logger.info(
    {
      companyId: stateRow.company_id,
      igUsername: exchange.igUsername,
    },
    "instagram connected",
  );

  return redirectBack({ ig_connect: "ok", username: exchange.igUsername });
});

// ─── POST /api/integrations/instagram/disconnect ────────────────────────────
integrationsRoutes.post("/instagram/disconnect", async (c) => {
  await deleteToken(undefined, c.var.company.companyId, "instagram_graph");
  return c.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// GOOGLE / YouTube
// ════════════════════════════════════════════════════════════════════════════

// ─── POST /api/integrations/google/connect ──────────────────────────────────
integrationsRoutes.post("/google/connect", async (c) => {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json(
      {
        error: "not_configured",
        message:
          "GOOGLE_CLIENT_ID/SECRET not set on server. Connect requires a Google Cloud OAuth client.",
      },
      503,
    );
  }
  const state = randomBytes(24).toString("hex");
  const redirectUri = `${env.API_PUBLIC_URL}/api/integrations/google/callback`;

  await createOAuthState(undefined, {
    state,
    userId: c.var.auth.userId,
    companyId: c.var.company.companyId,
    provider: "youtube",
  });

  setCookie(c, "google_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/integrations",
    maxAge: 60 * 15,
  });

  return c.json({ authorize_url: buildGoogleAuthorizeUrl({ state, redirectUri }) });
});

// ─── GET /api/integrations/google/callback ──────────────────────────────────
integrationsPublicRoutes.get("/google/callback", async (c) => {
  const env = loadEnv();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");

  const redirectBack = (params: Record<string, string>) => {
    // Returns to the YouTube workspace specifically — that's where the user
    // most likely initiated the connect.
    const u = new URL(`${env.WEB_PUBLIC_URL}/agents/youtube-growth`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return c.redirect(u.toString());
  };

  if (errorParam) {
    return redirectBack({ google_connect: "error", reason: errorParam });
  }
  if (!code || !state) {
    return redirectBack({ google_connect: "error", reason: "missing_code_or_state" });
  }

  const cookieState = getCookie(c, "google_oauth_state");
  if (cookieState !== state) {
    deleteCookie(c, "google_oauth_state", { path: "/api/integrations" });
    return redirectBack({ google_connect: "error", reason: "state_mismatch" });
  }
  deleteCookie(c, "google_oauth_state", { path: "/api/integrations" });

  const stateRow = await consumeOAuthState(undefined, state);
  if (!stateRow) {
    return redirectBack({ google_connect: "error", reason: "state_expired" });
  }
  if (stateRow.provider !== "youtube") {
    return redirectBack({ google_connect: "error", reason: "wrong_provider" });
  }

  const redirectUri = `${env.API_PUBLIC_URL}/api/integrations/google/callback`;
  let exchange;
  try {
    exchange = await exchangeGoogleCode({ code, redirectUri });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, companyId: stateRow.company_id },
      "google oauth exchange failed",
    );
    return redirectBack({
      google_connect: "error",
      reason: (err as Error).message.slice(0, 200),
    });
  }

  await upsertToken(undefined, {
    companyId: stateRow.company_id,
    provider: "youtube",
    // We store BOTH access (short-lived) and refresh tokens. Refresh is the
    // critical one — access can be re-derived from it whenever needed.
    accessTokenEncrypted: encryptString(exchange.accessToken),
    refreshTokenEncrypted: encryptString(exchange.refreshToken),
    expiresAt: exchange.expiresAt,
    metadata: {
      channel_id: exchange.channel.id,
      channel_title: exchange.channel.title,
      channel_custom_url: exchange.channel.customUrl,
      channel_thumbnail_url: exchange.channel.thumbnailUrl,
    },
  });

  logger.info(
    { companyId: stateRow.company_id, channelTitle: exchange.channel.title },
    "google/youtube connected",
  );

  return redirectBack({
    google_connect: "ok",
    channel: exchange.channel.title ?? "",
  });
});

// ─── POST /api/integrations/google/disconnect ───────────────────────────────
integrationsRoutes.post("/google/disconnect", async (c) => {
  await deleteToken(undefined, c.var.company.companyId, "youtube");
  return c.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// YOUTUBE STUDIO (cookies for Playwright automation)
// ════════════════════════════════════════════════════════════════════════════
//
// The Data API can't pin comments / edit end screens / set up A/B titles —
// only the Studio UI can. We drive that UI server-side with Playwright,
// authenticating via cookies the user provides.
//
// Cookie acquisition is the user's responsibility (browser extension or
// devtools export). We just take the array, encrypt it, and stash it.

const studioCookieSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().max(8192),
  domain: z.string().min(1).max(200),
  path: z.string().max(200).default("/"),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
const studioCookiesBodySchema = z.object({
  cookies: z.array(studioCookieSchema).min(1).max(200),
});

// ─── GET /api/integrations/youtube-studio/status ────────────────────────────
integrationsRoutes.get("/youtube-studio/status", async (c) => {
  const session = await getStudioSession(undefined, c.var.company.companyId);
  if (!session) return c.json({ connected: false });
  return c.json({
    connected: !session.invalid,
    invalid_reason: session.invalid_reason,
    expires_at: session.expires_at,
    last_validated_at: session.last_validated_at,
    connected_at: session.created_at,
  });
});

// ─── POST /api/integrations/youtube-studio/cookies ──────────────────────────
integrationsRoutes.post("/youtube-studio/cookies", async (c) => {
  const body = studioCookiesBodySchema.parse(await c.req.json());

  // Pick the earliest expiry among cookies that have one — that's effectively
  // when the *whole* session expires (login session typically has a SID cookie
  // that's the gating one).
  const expiriesEpoch = body.cookies
    .map((k) => k.expires)
    .filter((e): e is number => typeof e === "number" && e > 0);
  const earliestExpiry = expiriesEpoch.length
    ? new Date(Math.min(...expiriesEpoch) * 1000)
    : null;

  const encrypted = encryptString(JSON.stringify(body.cookies));
  const session = await upsertStudioSession(undefined, {
    companyId: c.var.company.companyId,
    cookiesEncrypted: encrypted,
    expiresAt: earliestExpiry,
  });

  logger.info(
    {
      companyId: c.var.company.companyId,
      cookieCount: body.cookies.length,
      expiresAt: session.expires_at,
    },
    "youtube-studio: cookies stored",
  );

  return c.json({
    connected: true,
    expires_at: session.expires_at,
    cookie_count: body.cookies.length,
  });
});

// ─── DELETE /api/integrations/youtube-studio ────────────────────────────────
integrationsRoutes.delete("/youtube-studio", async (c) => {
  await deleteStudioSession(undefined, c.var.company.companyId);
  return c.json({ ok: true });
});
