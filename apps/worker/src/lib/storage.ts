import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../env.js";

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const env = loadEnv();
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/**
 * Uploads a PNG buffer to Supabase Storage and returns the public URL.
 * Bucket is created in migration 0001 with public=true, so URLs are
 * permanent and CDN-cacheable.
 */
export async function uploadPng(args: {
  bucket: string;
  path: string;
  data: Uint8Array | Buffer;
  /** Default cache: 1 day (renders may be replaced when post is regenerated). */
  cacheControl?: string;
  upsert?: boolean;
}): Promise<{ url: string; path: string }> {
  const client = getClient();
  const { error } = await client.storage.from(args.bucket).upload(args.path, args.data, {
    contentType: "image/png",
    cacheControl: args.cacheControl ?? "86400",
    upsert: args.upsert ?? true,
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const { data } = client.storage.from(args.bucket).getPublicUrl(args.path);
  return { url: data.publicUrl, path: args.path };
}
