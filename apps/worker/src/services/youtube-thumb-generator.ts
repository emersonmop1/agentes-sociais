/**
 * Thumbnail image generator for the worker.
 *
 * Calls Gemini Image (multimodal) with:
 *   • the strategist's image_prompt (text)
 *   • optional creator_face reference images (passed as inlineData) when
 *     use_creator_face is true — Gemini Image conditions on those faces
 *     to keep the creator visually consistent across thumbs.
 *
 * Output is uploaded to the youtube-thumbs bucket and the public URL
 * returned. Same env model toggle (IMAGE_MODEL) as the API-side generator.
 */

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger.js";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const BUCKET = "youtube-thumbs";

let _gen: GoogleGenerativeAI | null = null;
let _supa: SupabaseClient | null = null;

function client(): GoogleGenerativeAI {
  if (_gen) return _gen;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY required for thumbnail generation");
  _gen = new GoogleGenerativeAI(key);
  return _gen;
}

function storage(): SupabaseClient {
  if (_supa) return _supa;
  _supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supa;
}

function imageModel(): string {
  return process.env.IMAGE_MODEL ?? DEFAULT_MODEL;
}

export interface GenerateThumbArgs {
  prompt: string;
  /** Public URLs of creator face references — fetched + sent as conditioning. */
  creatorFaceUrls?: string[];
  /** Storage path (without extension) under the youtube-thumbs bucket. */
  storagePath: string;
}

async function fetchAsInlineData(url: string): Promise<Part | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const mime = r.headers.get("content-type") ?? "image/png";
    return {
      inlineData: {
        mimeType: mime,
        data: Buffer.from(buf).toString("base64"),
      },
    };
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, "face fetch failed");
    return null;
  }
}

export async function generateThumbnail(
  args: GenerateThumbArgs,
): Promise<{ url: string; path: string }> {
  const model = client().getGenerativeModel({ model: imageModel() });

  // Compose multimodal parts: optional face refs + text prompt
  const parts: Part[] = [];
  if (args.creatorFaceUrls?.length) {
    for (const url of args.creatorFaceUrls.slice(0, 3)) {
      const part = await fetchAsInlineData(url);
      if (part) parts.push(part);
    }
  }
  parts.push({
    text:
      args.prompt +
      "\n\nFormat: 1280x720 (16:9), high contrast, optimized for YouTube thumbnail click-through.",
  });

  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
  });
  const respParts = result.response.candidates?.[0]?.content?.parts ?? [];
  const inline = respParts.find((p) => "inlineData" in p && p.inlineData);
  if (!inline || !("inlineData" in inline) || !inline.inlineData) {
    const textHint = respParts
      .map((p) => ("text" in p ? (p as { text?: string }).text : null))
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
    throw new Error(
      `Gemini Image returned no image data${textHint ? ` (model said: ${textHint})` : ""}`,
    );
  }

  const data = inline.inlineData as { data: string; mimeType: string };
  const bytes = Buffer.from(data.data, "base64");
  const ext = data.mimeType.includes("png") ? "png" : data.mimeType.includes("jpeg") ? "jpg" : "bin";
  const path = `${args.storagePath}.${ext}`;

  const { error } = await storage().storage.from(BUCKET).upload(path, bytes, {
    contentType: data.mimeType,
    cacheControl: "604800",
    upsert: true,
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  const { data: pub } = storage().storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}
