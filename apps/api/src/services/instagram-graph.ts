/**
 * Instagram Graph API integration.
 *
 * Two domains in this file:
 *   1. OAuth (Facebook Login) — used by /api/integrations/instagram/* routes
 *   2. Carousel publishing — used by the worker's publish-instagram handler
 *
 * OAuth flow (Facebook Login for Business → Instagram):
 *   1. App redirects user to https://www.facebook.com/v21.0/dialog/oauth
 *   2. User grants pages_show_list, pages_read_engagement,
 *      instagram_basic, instagram_content_publish, business_management
 *   3. Facebook redirects to our callback with ?code=…&state=…
 *   4. We exchange code → short-lived user token
 *   5. Exchange short-lived → long-lived (60-day) user token
 *   6. List the user's Pages → pick the one bound to the IG Business account
 *   7. Get the Page access token from /me/accounts
 *   8. Resolve the IG Business User ID via /{page-id}?fields=instagram_business_account
 *   9. Store the Page access token (long-lived, doesn't expire if user keeps app)
 *
 * Publishing flow:
 *   1. POST /{ig-user-id}/media (one per slide, is_carousel_item=true) → container ids
 *   2. POST /{ig-user-id}/media (media_type=CAROUSEL, children=[ids], caption=...) → carousel_id
 *   3. POST /{ig-user-id}/media_publish?creation_id=carousel_id → final media id
 *   4. (optional) POST /{media_id}/comments?message=first_comment
 */

import { loadEnv } from "../env.js";
import { logger } from "../lib/logger.js";

const FB_GRAPH = "https://graph.facebook.com/v21.0";

// ─── OAuth helpers ────────────────────────────────────────────────────────

export interface OAuthAuthorizeArgs {
  state: string;
  redirectUri: string;
}

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

export function buildAuthorizeUrl(args: OAuthAuthorizeArgs): string {
  const env = loadEnv();
  if (!env.INSTAGRAM_APP_ID) {
    throw new Error("INSTAGRAM_APP_ID not configured");
  }
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", env.INSTAGRAM_APP_ID);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export interface ExchangeResult {
  /** Long-lived Page access token. This is what you store. */
  pageAccessToken: string;
  igUserId: string;
  igUsername: string;
  fbPageId: string;
  fbPageName: string;
  /** Long-lived tokens last 60 days unless they're Page tokens (no expiry). */
  expiresAt: Date | null;
}

/**
 * Walks through code → user token → long-lived token → Pages → IG account
 * → Page token. Returns everything needed to publish.
 */
export async function exchangeCodeForPageToken(args: {
  code: string;
  redirectUri: string;
}): Promise<ExchangeResult> {
  const env = loadEnv();
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    throw new Error("INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET not configured");
  }

  // 1. code → short-lived user token
  const shortRes = await graphFetch(`${FB_GRAPH}/oauth/access_token`, {
    client_id: env.INSTAGRAM_APP_ID,
    client_secret: env.INSTAGRAM_APP_SECRET,
    redirect_uri: args.redirectUri,
    code: args.code,
  });
  const shortToken = (shortRes as { access_token: string }).access_token;

  // 2. short → long-lived user token
  const longRes = await graphFetch(`${FB_GRAPH}/oauth/access_token`, {
    grant_type: "fb_exchange_token",
    client_id: env.INSTAGRAM_APP_ID,
    client_secret: env.INSTAGRAM_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const longUserToken = (longRes as { access_token: string; expires_in?: number }).access_token;
  const expiresIn = (longRes as { expires_in?: number }).expires_in;
  const userTokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  // 3. List user's Pages (Page tokens are long-lived without expiry once derived from a long-lived user token)
  const pagesRes = (await graphFetch(`${FB_GRAPH}/me/accounts`, {
    access_token: longUserToken,
    fields: "id,name,access_token,instagram_business_account",
  })) as {
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string };
    }>;
  };

  const pageWithIg = pagesRes.data.find((p) => p.instagram_business_account?.id);
  if (!pageWithIg) {
    throw new Error(
      "No Page with an Instagram Business account found. Connect IG to a Facebook Page first.",
    );
  }

  // 4. Resolve IG username for display
  const igRes = (await graphFetch(
    `${FB_GRAPH}/${pageWithIg.instagram_business_account!.id}`,
    {
      access_token: pageWithIg.access_token,
      fields: "id,username",
    },
  )) as { id: string; username: string };

  return {
    pageAccessToken: pageWithIg.access_token,
    igUserId: pageWithIg.instagram_business_account!.id,
    igUsername: igRes.username,
    fbPageId: pageWithIg.id,
    fbPageName: pageWithIg.name,
    // Page tokens derived from long-lived user tokens have no expiry, but we
    // record the user-token expiry as a hint for proactive re-validation.
    expiresAt: userTokenExpiresAt,
  };
}

// ─── Publishing helpers ──────────────────────────────────────────────────

export interface PublishArgs {
  igUserId: string;
  pageAccessToken: string;
  /** Public PNG URLs (Supabase Storage). Order = carousel order. */
  imageUrls: string[];
  caption: string;
  /** Optional pinned comment. */
  firstComment?: string | null;
}

export interface PublishResult {
  mediaId: string;
  permalink?: string;
}

/**
 * Publish a carousel to Instagram. Throws on any step failure with a useful
 * message; the worker's retry policy will decide whether to retry.
 */
export async function publishCarousel(args: PublishArgs): Promise<PublishResult> {
  if (args.imageUrls.length === 0) {
    throw new Error("Cannot publish empty carousel");
  }
  if (args.imageUrls.length > 10) {
    throw new Error("Instagram carousels max out at 10 slides");
  }

  // Step 1 — create one media container per slide
  const containerIds: string[] = [];
  for (const url of args.imageUrls) {
    const r = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media`, {
      image_url: url,
      is_carousel_item: "true",
      access_token: args.pageAccessToken,
    })) as { id: string };
    containerIds.push(r.id);
  }

  // Step 2 — create the carousel container
  const carousel = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: containerIds.join(","),
    caption: args.caption,
    access_token: args.pageAccessToken,
  })) as { id: string };

  // Step 3 — Wait for carousel to be ready + publish
  await waitForContainerReady(carousel.id, args.pageAccessToken);
  const published = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media_publish`, {
    creation_id: carousel.id,
    access_token: args.pageAccessToken,
  })) as { id: string };

  // Step 4 — fetch permalink (best effort)
  let permalink: string | undefined;
  try {
    const perm = (await graphFetch(`${FB_GRAPH}/${published.id}`, {
      access_token: args.pageAccessToken,
      fields: "permalink",
    })) as { permalink?: string };
    permalink = perm.permalink;
  } catch {
    // permalink fetch is non-critical
  }

  // Step 5 — first comment (best effort, don't fail the whole publish)
  if (args.firstComment) {
    try {
      await graphFetch(`${FB_GRAPH}/${published.id}/comments`, {
        message: args.firstComment,
        access_token: args.pageAccessToken,
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, mediaId: published.id },
        "instagram first_comment failed (non-fatal)",
      );
    }
  }

  return { mediaId: published.id, permalink };
}

/**
 * Carousel containers take a few seconds to be ready. Poll status_code.
 * Most carousels are ready in ~5s. Caller imposes a hard cap via timeout.
 */
async function waitForContainerReady(
  creationId: string,
  pageAccessToken: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = (await graphFetch(`${FB_GRAPH}/${creationId}`, {
      access_token: pageAccessToken,
      fields: "status_code,status",
    })) as { status_code?: string; status?: string };
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new Error(`Carousel container ${r.status_code}: ${r.status ?? ""}`);
    }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  throw new Error("Timed out waiting for carousel container to be ready");
}

// ─── Low-level Graph API fetch ───────────────────────────────────────────

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

class GraphAPIError extends Error {
  constructor(
    public status: number,
    public body: GraphErrorBody,
    message: string,
  ) {
    super(message);
    this.name = "GraphAPIError";
  }

  /** Auth-related (token revoked / expired / wrong perms). */
  get isAuthError(): boolean {
    if (this.status === 401 || this.status === 403) return true;
    const code = this.body.error?.code;
    return code === 190 || code === 102 || code === 200;
  }
}

async function graphFetch(
  url: string,
  params: Record<string, string>,
): Promise<unknown> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = parsed as GraphErrorBody;
    throw new GraphAPIError(
      res.status,
      err,
      `Graph API ${res.status}: ${err.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return parsed;
}

export { GraphAPIError };
