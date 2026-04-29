/**
 * Worker-side Instagram Graph publisher. Slim version of the API's service —
 * only the publishCarousel function the worker needs.
 */

import { logger } from "../lib/logger.js";

const FB_GRAPH = "https://graph.facebook.com/v21.0";

export interface PublishArgs {
  igUserId: string;
  pageAccessToken: string;
  imageUrls: string[];
  caption: string;
  firstComment?: string | null;
}

export interface PublishResult {
  mediaId: string;
  permalink?: string;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

export class GraphAPIError extends Error {
  constructor(
    public status: number,
    public body: GraphErrorBody,
    message: string,
  ) {
    super(message);
    this.name = "GraphAPIError";
  }
  get isAuthError(): boolean {
    if (this.status === 401 || this.status === 403) return true;
    const code = this.body.error?.code;
    return code === 190 || code === 102 || code === 200;
  }
}

async function graphFetch(url: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
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

export async function publishCarousel(args: PublishArgs): Promise<PublishResult> {
  if (args.imageUrls.length === 0) throw new Error("Empty carousel");
  if (args.imageUrls.length > 10) throw new Error("Max 10 slides");

  const containerIds: string[] = [];
  for (const url of args.imageUrls) {
    const r = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media`, {
      image_url: url,
      is_carousel_item: "true",
      access_token: args.pageAccessToken,
    })) as { id: string };
    containerIds.push(r.id);
  }

  const carousel = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: containerIds.join(","),
    caption: args.caption,
    access_token: args.pageAccessToken,
  })) as { id: string };

  await waitForContainerReady(carousel.id, args.pageAccessToken);

  const published = (await graphFetch(`${FB_GRAPH}/${args.igUserId}/media_publish`, {
    creation_id: carousel.id,
    access_token: args.pageAccessToken,
  })) as { id: string };

  let permalink: string | undefined;
  try {
    const perm = (await graphFetch(`${FB_GRAPH}/${published.id}`, {
      access_token: args.pageAccessToken,
      fields: "permalink",
    })) as { permalink?: string };
    permalink = perm.permalink;
  } catch {
    // non-critical
  }

  if (args.firstComment) {
    try {
      await graphFetch(`${FB_GRAPH}/${published.id}/comments`, {
        message: args.firstComment,
        access_token: args.pageAccessToken,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "first_comment failed (non-fatal)");
    }
  }

  return { mediaId: published.id, permalink };
}

// ─── Engagement / insights ────────────────────────────────────────────────
// Reads metrics for a single media object. Field set covers what shows up
// in the kanban analytics card. Carousel ALBUM supports a subset (no
// impressions for older API versions, no taps_forward) — we ask for the
// safe-everywhere subset so the call doesn't 400 on unsupported metrics.
//
// Endpoint: GET /{ig-media-id}/insights?metric=...
//
// Returns null when the token is invalid (caller can mark token).

const SAFE_METRICS = ["likes", "comments", "saved", "reach", "shares", "total_interactions"];

export interface MediaInsights {
  likes: number;
  comments: number;
  saved: number;
  reach: number;
  shares: number;
  total_interactions: number;
  fetched_at: string;
}

interface InsightsApiResponse {
  data?: Array<{
    name: string;
    values?: Array<{ value?: number }>;
  }>;
}

export async function fetchMediaInsights(args: {
  mediaId: string;
  pageAccessToken: string;
}): Promise<MediaInsights> {
  const url = new URL(`${FB_GRAPH}/${args.mediaId}/insights`);
  url.searchParams.set("metric", SAFE_METRICS.join(","));
  url.searchParams.set("access_token", args.pageAccessToken);

  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    throw new GraphAPIError(
      res.status,
      parsed as GraphErrorBody,
      `insights ${res.status}: ${(parsed as GraphErrorBody).error?.message ?? text.slice(0, 200)}`,
    );
  }

  const data = (parsed as InsightsApiResponse).data ?? [];
  const out: MediaInsights = {
    likes: 0,
    comments: 0,
    saved: 0,
    reach: 0,
    shares: 0,
    total_interactions: 0,
    fetched_at: new Date().toISOString(),
  };
  for (const item of data) {
    const v = item.values?.[0]?.value ?? 0;
    if (item.name in out) {
      (out as unknown as Record<string, number>)[item.name] = v;
    }
  }
  return out;
}

