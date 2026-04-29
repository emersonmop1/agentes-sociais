/**
 * Image generation via Gemini Image (a.k.a. "Nano Banana", model
 * `gemini-2.5-flash-image-preview`). Used by the `dark` visual style for
 * cinematographic carousels. Search images make `dark` look generic; gen
 * images give it the dramatic, posed feel the style is built for.
 *
 * Output is uploaded to the `generated-images` Storage bucket and returned
 * as an ImageResult — same shape as the search-source results, so the
 * caller doesn't need to branch.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../env.js";
import type { ImageResult } from "../db/repositories/image-cache.js";
import { logger } from "../lib/logger.js";

// Default to Flash (cheaper, ~5s). Override to "gemini-3-pro-image-preview"
// via IMAGE_MODEL env for higher-quality cinematic output.
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const BUCKET = "generated-images";

function imageModel(): string {
  return process.env.IMAGE_MODEL ?? DEFAULT_MODEL;
}

let _gen: GoogleGenerativeAI | null = null;
let _supa: SupabaseClient | null = null;

function client(): GoogleGenerativeAI {
  if (_gen) return _gen;
  const env = loadEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY required for image generation");
  }
  _gen = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return _gen;
}

function storage(): SupabaseClient {
  if (_supa) return _supa;
  const env = loadEnv();
  _supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supa;
}

export interface GenerateImageArgs {
  /** The agent-provided search_query (in English). Used as core prompt. */
  query: string;
  /** Optional user-provided override that fully replaces the prompt. */
  customPrompt?: string;
  /** Visual style controls the modifier preset. */
  style?: "dark" | "tweet_thread" | "tweet_single" | "acid_text";
  /** Brand color hint (HEX) — fed into the prompt as accent color. */
  accentColor?: string;
  /** Where to put the file in Storage. Caller owns naming. */
  storagePath: string;
}

const STYLE_MODIFIERS: Record<NonNullable<GenerateImageArgs["style"]>, string> = {
  dark:
    "cinematic, dramatic lighting, dark moody atmosphere, photo-realistic, shallow depth of field, " +
    "high contrast, film grain, no text, no logos, vertical composition optimized for 4:5 aspect ratio",
  tweet_thread:
    "natural lighting, candid documentary style, photo-realistic, sharp focus, no text, no logos, " +
    "vertical composition optimized for 4:5 aspect ratio",
  tweet_single:
    "bold editorial photography, vibrant, photo-realistic, no text, no logos, " +
    "vertical composition optimized for 4:5 aspect ratio",
  acid_text: "minimal background, abstract, no text, no logos",
};

function buildPrompt(args: GenerateImageArgs): string {
  if (args.customPrompt) return args.customPrompt;
  const modifiers = STYLE_MODIFIERS[args.style ?? "dark"];
  const colorHint = args.accentColor
    ? ` Subtle accent color reference: ${args.accentColor}.`
    : "";
  return `${args.query}. ${modifiers}.${colorHint} Output: a single high-resolution photograph.`;
}

export async function generateImage(
  args: GenerateImageArgs,
): Promise<ImageResult> {
  const prompt = buildPrompt(args);
  const model = client().getGenerativeModel({ model: imageModel() });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  // Gemini Image returns the bytes inline as base64 in `inlineData`.
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => "inlineData" in p && p.inlineData);
  if (!inline || !("inlineData" in inline) || !inline.inlineData) {
    const textHint = parts
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

  const path = args.storagePath.endsWith(`.${ext}`)
    ? args.storagePath
    : `${args.storagePath}.${ext}`;

  const { error } = await storage().storage.from(BUCKET).upload(path, bytes, {
    contentType: data.mimeType,
    cacheControl: "604800", // 7 days
    upsert: true,
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const { data: pub } = storage().storage.from(BUCKET).getPublicUrl(path);

  logger.info(
    { path, mime: data.mimeType, bytes: bytes.length, prompt: prompt.slice(0, 120) },
    "image-generator: generated",
  );

  return {
    url: pub.publicUrl,
    source_url: pub.publicUrl,
    credit: "Generated with Gemini",
  };
}
