import { exec, many, one, type Queryable } from "../client.js";

export interface ImageResult {
  url: string;
  source_url?: string;
  credit?: string;
  width?: number;
  height?: number;
}

export interface ImageCacheRow {
  id: string;
  search_query: string;
  source: string;
  results: ImageResult[];
  created_at: string;
  expires_at: string;
}

export async function getCached(
  q: Queryable | undefined,
  query: string,
  source: string,
): Promise<ImageResult[] | null> {
  const row = await one<ImageCacheRow>(
    q,
    `SELECT * FROM public.creator_image_cache
      WHERE LOWER(search_query) = LOWER($1)
        AND source = $2
        AND expires_at > now()
      LIMIT 1`,
    [query.trim(), source],
  );
  return row?.results ?? null;
}

export async function getAnyCached(
  q: Queryable | undefined,
  query: string,
): Promise<ImageResult[] | null> {
  const rows = await many<ImageCacheRow>(
    q,
    `SELECT * FROM public.creator_image_cache
      WHERE LOWER(search_query) = LOWER($1)
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [query.trim()],
  );
  return rows[0]?.results ?? null;
}

export async function setCached(
  q: Queryable | undefined,
  query: string,
  source: string,
  results: ImageResult[],
): Promise<void> {
  await exec(
    q,
    `INSERT INTO public.creator_image_cache (search_query, source, results, expires_at)
     VALUES ($1, $2, $3::jsonb, now() + INTERVAL '7 days')
     ON CONFLICT (search_query, source) DO UPDATE
       SET results = EXCLUDED.results,
           created_at = now(),
           expires_at = now() + INTERVAL '7 days'`,
    [query.trim(), source, JSON.stringify(results)],
  );
}
