/**
 * YouTube Data API v3 client — minimal slice needed for our publish flow.
 *
 * Used by both the API (channel info) and the worker (resumable upload).
 * Token refresh is exposed here as a helper because both processes need it.
 */

import { refreshAccessToken } from "./google-oauth.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";

interface YouTubeAPIErrorBody {
  error?: { message?: string; code?: number; errors?: { reason?: string }[] };
}

export class YouTubeAPIError extends Error {
  constructor(
    public status: number,
    public body: YouTubeAPIErrorBody,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeAPIError";
  }
  /** Token-related: our caller should refresh-or-reauth. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
  get reasons(): string[] {
    return this.body.error?.errors?.map((e) => e.reason ?? "").filter(Boolean) ?? [];
  }
}

async function ytFetch(
  url: string | URL,
  init: RequestInit & { accessToken: string },
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = parsed as YouTubeAPIErrorBody;
    throw new YouTubeAPIError(
      res.status,
      err,
      `YouTube ${res.status}: ${err.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return parsed;
}

// ─── channels.list ──────────────────────────────────────────────────────────

export interface YouTubeChannel {
  id: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
}

export async function listMyChannel(
  accessToken: string,
): Promise<YouTubeChannel | null> {
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const data = (await ytFetch(url, { accessToken })) as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
    }>;
  };
  const item = data.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    customUrl: item.snippet?.customUrl ?? null,
    thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
  };
}

// ─── videos.insert (resumable upload) ───────────────────────────────────────

export interface InsertVideoArgs {
  accessToken: string;
  /** Stream the bytes from this URL (Storage public URL, presigned, etc.) */
  videoUrl: string;
  /** Optional pre-known content type. Defaults to video/mp4. */
  contentType?: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;            // Default 22 = "People & Blogs"
  privacyStatus?: "private" | "unlisted" | "public";
  selfDeclaredMadeForKids?: boolean;
  publishAt?: string;             // ISO if scheduled
  /** Optional onProgress(uploaded, total). */
  onProgress?: (uploaded: number, total: number) => void;
}

export interface InsertVideoResult {
  id: string;
  /** Snippet returned by the API. */
  snippet: { title: string; description: string };
  /** Status returned by the API. */
  status: { privacyStatus: string; publishAt?: string };
}

/**
 * Resumable upload in two steps:
 *   1. POST .../videos?uploadType=resumable with snippet/status JSON →
 *      response Location header is the upload URL.
 *   2. PUT video bytes to that URL. On success returns the final Video resource.
 *
 * For v1 we stream the bytes from a single fetch into a single PUT (no
 * chunked upload). Works fine for videos under ~250MB. Larger videos will
 * need multi-part chunked upload — punt to a future iteration.
 */
export async function insertVideo(args: InsertVideoArgs): Promise<InsertVideoResult> {
  const metadata = {
    snippet: {
      title: args.title.slice(0, 100), // YouTube limit
      description: args.description?.slice(0, 5000) ?? "",
      tags: (args.tags ?? []).slice(0, 50),
      categoryId: args.categoryId ?? "22",
    },
    status: {
      privacyStatus: args.privacyStatus ?? "private",
      selfDeclaredMadeForKids: args.selfDeclaredMadeForKids ?? false,
      ...(args.publishAt && { publishAt: args.publishAt }),
    },
  };

  // Step 1 — initiate resumable upload
  const startUrl = new URL(`${UPLOAD_BASE}/videos`);
  startUrl.searchParams.set("uploadType", "resumable");
  startUrl.searchParams.set("part", "snippet,status");

  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": args.contentType ?? "video/mp4",
    },
    body: JSON.stringify(metadata),
  });
  if (!startRes.ok) {
    const txt = await startRes.text();
    throw new YouTubeAPIError(
      startRes.status,
      JSON.parse(txt || "{}"),
      `videos.insert init ${startRes.status}: ${txt.slice(0, 200)}`,
    );
  }
  const uploadUrl = startRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return an upload URL");
  }

  // Step 2 — fetch the source video and PUT bytes
  const srcRes = await fetch(args.videoUrl);
  if (!srcRes.ok || !srcRes.body) {
    throw new Error(`Could not fetch source video (${srcRes.status})`);
  }
  const totalBytes = Number(srcRes.headers.get("content-length") ?? "0");
  const contentType =
    srcRes.headers.get("content-type") ?? args.contentType ?? "video/mp4";

  // Read to buffer (simpler than streaming a stream → fetch). For very large
  // videos this is expensive memory-wise; chunked upload would be better but
  // adds complexity. Cap at ~512MB for safety.
  const buf = Buffer.from(await srcRes.arrayBuffer());
  if (buf.length === 0) throw new Error("Source video is empty");
  if (buf.length > 512 * 1024 * 1024) {
    throw new Error(
      `Source video too large (${(buf.length / 1024 / 1024).toFixed(0)}MB > 512MB cap)`,
    );
  }
  args.onProgress?.(0, buf.length);

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
    },
    body: new Uint8Array(buf),
  });
  if (!putRes.ok) {
    const txt = await putRes.text();
    throw new YouTubeAPIError(
      putRes.status,
      (() => {
        try { return JSON.parse(txt); } catch { return {}; }
      })(),
      `video upload PUT ${putRes.status}: ${txt.slice(0, 200)}`,
    );
  }
  args.onProgress?.(buf.length, buf.length);

  const video = (await putRes.json()) as InsertVideoResult;
  return video;
}

// ─── thumbnails.set ─────────────────────────────────────────────────────────

export async function setThumbnail(args: {
  accessToken: string;
  videoId: string;
  /** URL of a PNG/JPG (e.g. our youtube-thumbs Storage URL). */
  thumbnailUrl: string;
}): Promise<void> {
  const imgRes = await fetch(args.thumbnailUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch thumbnail (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") ?? "image/png";

  const url = new URL(`${UPLOAD_BASE}/thumbnails/set`);
  url.searchParams.set("videoId", args.videoId);
  url.searchParams.set("uploadType", "media");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new YouTubeAPIError(
      res.status,
      (() => {
        try { return JSON.parse(txt); } catch { return {}; }
      })(),
      `thumbnails.set ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
}

// ─── Refresh helper ─────────────────────────────────────────────────────────

export { refreshAccessToken };
