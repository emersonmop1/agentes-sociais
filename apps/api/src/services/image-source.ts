/**
 * Per-slide image source dispatcher.
 *
 *   tweet_thread  → image-search (real photo)
 *   tweet_single  → image-search (real photo)
 *   dark          → image-generator (Gemini Image, cinematic)
 *   acid_text     → null (text-only)
 *
 * This is the only place the visual_style → image-source mapping lives.
 */

import type { VisualStyle } from "@agentes/shared";
import type { ImageResult } from "../db/repositories/image-cache.js";
import type { SlideConfig } from "../db/repositories/creator-posts.js";
import { logger } from "../lib/logger.js";
import { generateImage } from "./image-generator.js";
import { searchFirstImage } from "./image-search.js";

export interface FetchSlideImageArgs {
  postId: string;
  companyId: string;
  visualStyle: VisualStyle;
  slide: SlideConfig;
  brand: { primary_color?: string; accent_color?: string };
}

/**
 * Fetch (search OR generate) an image for a single slide. Returns null when
 * the style doesn't use images (acid_text) or when the underlying source
 * yields nothing usable.
 */
export async function fetchSlideImage(
  args: FetchSlideImageArgs,
): Promise<ImageResult | null> {
  if (args.visualStyle === "acid_text") return null;
  const query = args.slide.image?.search_query;
  if (!query) return null;

  if (args.visualStyle === "dark") {
    try {
      const path = `${args.companyId}/${args.postId}/slide_${String(args.slide.index).padStart(2, "0")}_${Date.now()}`;
      return await generateImage({
        query,
        style: "dark",
        accentColor: args.brand.accent_color ?? args.brand.primary_color,
        storagePath: path,
      });
    } catch (err) {
      // Fallback to search if generator fails — keeps the pipeline moving.
      logger.warn(
        { err: (err as Error).message, postId: args.postId, slideIndex: args.slide.index },
        "image-generator failed, falling back to search",
      );
      return searchFirstImage(query);
    }
  }

  // tweet_thread, tweet_single — real photos
  return searchFirstImage(query);
}
