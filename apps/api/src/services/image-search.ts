/**
 * Image search — multi-source with fallback + 7-day cache.
 *
 * MVP sources (final.md §8.5): Unsplash + Pexels. Add Pixabay/Google CSE/
 * Brave/SerpAPI later if "no results" rate gets uncomfortable.
 *
 * Domain blocklist drops watermarked stock results that occasionally leak
 * through search APIs.
 */

import { loadEnv } from "../env.js";
import { logger } from "../lib/logger.js";
import { getAnyCached, getCached, setCached, type ImageResult } from "../db/repositories/image-cache.js";

export type ImageSource = "unsplash" | "pexels" | "placeholder";

const ORDER: ImageSource[] = ["unsplash", "pexels"];

/**
 * Deterministic dev-mode fallback. Returns picsum.photos URLs seeded by
 * a hash of the query, so two slides with the same query get the same image
 * (consistent re-renders) and different queries get visually different images.
 *
 * Used only when no real provider is configured. In production you'll want
 * UNSPLASH_ACCESS_KEY or PEXELS_API_KEY for relevant images.
 */
function placeholderImages(query: string, limit: number): ImageResult[] {
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = ((hash << 5) - hash + query.charCodeAt(i)) | 0;
  }
  const out: ImageResult[] = [];
  for (let i = 0; i < limit; i++) {
    const seed = Math.abs(hash + i * 17);
    out.push({
      url: `https://picsum.photos/seed/${seed}/1080/1350`,
      source_url: `https://picsum.photos/`,
      credit: "Photo via Picsum (placeholder)",
      width: 1080,
      height: 1350,
    });
  }
  return out;
}

const BLOCKED_DOMAINS = [
  "shutterstock.com",
  "gettyimages.com",
  "dreamstime.com",
  "alamy.com",
  "istockphoto.com",
];

function isBlocked(url: string): boolean {
  return BLOCKED_DOMAINS.some((d) => url.toLowerCase().includes(d));
}

function isSourceConfigured(source: ImageSource): boolean {
  const env = loadEnv();
  switch (source) {
    case "unsplash":    return Boolean(env.UNSPLASH_ACCESS_KEY);
    case "pexels":      return Boolean(env.PEXELS_API_KEY);
    case "placeholder": return true;
  }
}

// ─── Provider implementations ────────────────────────────────────────────

async function fetchUnsplash(query: string, limit: number): Promise<ImageResult[]> {
  const env = loadEnv();
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(Math.min(limit, 30)));
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    results: Array<{
      urls: { regular: string; full: string };
      width: number;
      height: number;
      links: { html: string };
      user: { name: string };
    }>;
  };
  return data.results.map((p) => ({
    url: p.urls.regular,
    source_url: p.links.html,
    credit: `Photo by ${p.user.name} on Unsplash`,
    width: p.width,
    height: p.height,
  }));
}

async function fetchPexels(query: string, limit: number): Promise<ImageResult[]> {
  const env = loadEnv();
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(Math.min(limit, 30)));
  url.searchParams.set("orientation", "portrait");

  const res = await fetch(url, {
    headers: { Authorization: env.PEXELS_API_KEY ?? "" },
  });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    photos: Array<{
      src: { large: string; large2x: string };
      width: number;
      height: number;
      url: string;
      photographer: string;
    }>;
  };
  return data.photos.map((p) => ({
    url: p.src.large,
    source_url: p.url,
    credit: `Photo by ${p.photographer} on Pexels`,
    width: p.width,
    height: p.height,
  }));
}

async function fetchFromSource(
  source: ImageSource,
  query: string,
  limit: number,
): Promise<ImageResult[]> {
  switch (source) {
    case "unsplash":    return fetchUnsplash(query, limit);
    case "pexels":      return fetchPexels(query, limit);
    case "placeholder": return placeholderImages(query, limit);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface SearchOptions {
  /** Max number of results to return per search. */
  limit?: number;
  /** When true, skip the cache and force fresh fetch. */
  bypassCache?: boolean;
}

export interface SearchResult {
  source: ImageSource | "cache";
  results: ImageResult[];
}

/**
 * Search images for a query. Strategy:
 *   1. Check cache (any source).
 *   2. Try sources in ORDER until one returns ≥1 result.
 *   3. Cache the first source's hit.
 *   4. Filter blocked domains.
 *
 * Returns at most `limit` results. May return [] if all sources fail / are
 * unconfigured / return blocked-only results.
 */
export async function searchImages(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const limit = opts.limit ?? 5;

  if (!opts.bypassCache) {
    const cached = await getAnyCached(undefined, query);
    if (cached && cached.length > 0) {
      const filtered = cached.filter((r) => !isBlocked(r.url)).slice(0, limit);
      if (filtered.length > 0) return { source: "cache", results: filtered };
    }
  }

  for (const source of ORDER) {
    if (!isSourceConfigured(source)) continue;
    if (!opts.bypassCache) {
      const cachedHere = await getCached(undefined, query, source);
      if (cachedHere && cachedHere.length > 0) {
        const filtered = cachedHere.filter((r) => !isBlocked(r.url)).slice(0, limit);
        if (filtered.length > 0) return { source: "cache", results: filtered };
      }
    }
    try {
      const results = await fetchFromSource(source, query, limit * 2);
      const filtered = results.filter((r) => !isBlocked(r.url)).slice(0, limit);
      if (filtered.length > 0) {
        // Cache the raw (pre-filter) results so we don't re-fetch
        await setCached(undefined, query, source, results.slice(0, limit * 2));
        return { source, results: filtered };
      }
    } catch (err) {
      logger.warn(
        { source, err: (err as Error).message, query },
        "image-search: source failed, trying next",
      );
    }
  }

  // No real provider configured (or all failed) — fall back to placeholders.
  // Logged once at warn level so devs know they should configure a key.
  if (!isSourceConfigured("unsplash") && !isSourceConfigured("pexels")) {
    logger.debug(
      { query },
      "image-search: no provider configured, using picsum placeholder",
    );
  }
  return { source: "placeholder", results: placeholderImages(query, limit) };
}

/** Returns the first result, or null if nothing was found. */
export async function searchFirstImage(query: string): Promise<ImageResult | null> {
  const r = await searchImages(query, { limit: 1 });
  return r.results[0] ?? null;
}
