/**
 * Worker-side YouTube Data API client. Slim mirror of the API service —
 * resumable upload + thumbnail set + token refresh.
 */

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
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
  get isQuotaError(): boolean {
    return Boolean(
      this.body.error?.errors?.some((e) => /quota/i.test(e.reason ?? "")),
    );
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
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

export interface InsertVideoArgs {
  accessToken: string;
  videoUrl: string;
  contentType?: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: "private" | "unlisted" | "public";
  publishAt?: string;
}

export interface InsertVideoResult {
  id: string;
  snippet: { title: string; description: string };
  status: { privacyStatus: string; publishAt?: string };
}

export async function insertVideo(args: InsertVideoArgs): Promise<InsertVideoResult> {
  const metadata = {
    snippet: {
      title: args.title.slice(0, 100),
      description: args.description?.slice(0, 5000) ?? "",
      tags: (args.tags ?? []).slice(0, 50),
      categoryId: args.categoryId ?? "22",
    },
    status: {
      privacyStatus: args.privacyStatus ?? "private",
      selfDeclaredMadeForKids: false,
      ...(args.publishAt && { publishAt: args.publishAt }),
    },
  };

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
    let body: YouTubeAPIErrorBody = {};
    try { body = JSON.parse(txt); } catch { /* noop */ }
    throw new YouTubeAPIError(
      startRes.status,
      body,
      `videos.insert init ${startRes.status}: ${txt.slice(0, 200)}`,
    );
  }
  const uploadUrl = startRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL");

  const srcRes = await fetch(args.videoUrl);
  if (!srcRes.ok || !srcRes.body) {
    throw new Error(`Could not fetch source video (${srcRes.status})`);
  }
  const buf = Buffer.from(await srcRes.arrayBuffer());
  if (buf.length === 0) throw new Error("Source video is empty");
  if (buf.length > 512 * 1024 * 1024) {
    throw new Error(
      `Source video too large (${(buf.length / 1024 / 1024).toFixed(0)}MB > 512MB cap)`,
    );
  }
  const contentType =
    srcRes.headers.get("content-type") ?? args.contentType ?? "video/mp4";

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
    let body: YouTubeAPIErrorBody = {};
    try { body = JSON.parse(txt); } catch { /* noop */ }
    throw new YouTubeAPIError(
      putRes.status,
      body,
      `video upload PUT ${putRes.status}: ${txt.slice(0, 200)}`,
    );
  }
  return (await putRes.json()) as InsertVideoResult;
}

export async function setThumbnail(args: {
  accessToken: string;
  videoId: string;
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
    let body: YouTubeAPIErrorBody = {};
    try { body = JSON.parse(txt); } catch { /* noop */ }
    throw new YouTubeAPIError(
      res.status,
      body,
      `thumbnails.set ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
}
