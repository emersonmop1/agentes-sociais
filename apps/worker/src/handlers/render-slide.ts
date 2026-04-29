/**
 * render-slide handler — consumes a creator_render_jobs row and:
 *   1. Loads the post
 *   2. For each slide in slide_indexes (or all if empty), renders PNG via Playwright
 *   3. Uploads PNG to Supabase Storage
 *   4. Patches slides_config[i].rendered_url + rendered_at
 *   5. Bumps post.cover_image_url to slide 0's URL
 *   6. Marks render job completed and transitions post copy_approved → design_review
 */

import { getPool } from "../db.js";
import { logger } from "../lib/logger.js";
import { uploadPng } from "../lib/storage.js";
import {
  renderSlide,
  type BrandData,
  type SlideData,
  type VisualStyleSlug,
} from "../services/carousel-renderer.js";

interface RenderJobRow {
  id: string;
  post_id: string;
  company_id: string;
  slide_indexes: number[];
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  error: string | null;
  output_urls: string[];
  leased_at: string | null;
  leased_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface CreatorPostRow {
  id: string;
  company_id: string;
  status: string;
  visual_style: VisualStyleSlug;
  slides_config: SlideData[];
  brand_snapshot: BrandData;
  slides_storage_prefix: string | null;
}

const STORAGE_BUCKET = "slides";

export async function handleRenderJob(job: RenderJobRow): Promise<void> {
  const pool = getPool();
  const startedAt = Date.now();

  // Load post
  const postR = await pool.query<CreatorPostRow>(
    `SELECT id, company_id, status, visual_style, slides_config, brand_snapshot, slides_storage_prefix
       FROM public.creator_posts WHERE id = $1`,
    [job.post_id],
  );
  const post = postR.rows[0];
  if (!post) {
    await markFailed(job.id, "post_not_found");
    return;
  }

  // Decide which slides to render
  const allSlides = post.slides_config ?? [];
  const targetIndexes =
    job.slide_indexes.length === 0
      ? allSlides.map((_s, i) => i)
      : job.slide_indexes;

  if (targetIndexes.length === 0 || allSlides.length === 0) {
    await markFailed(job.id, "no_slides_to_render");
    return;
  }

  const prefix = post.slides_storage_prefix ?? `${post.company_id}/${post.id}`;
  const outputUrls: string[] = [];
  const updatedSlides = [...allSlides];

  for (const i of targetIndexes) {
    const slide = updatedSlides[i];
    if (!slide) {
      logger.warn({ postId: post.id, i }, "slide index out of range");
      continue;
    }
    try {
      const png = await renderSlide({
        visualStyle: post.visual_style,
        slide,
        brand: post.brand_snapshot,
        totalSlides: allSlides.length,
      });
      const path = `${prefix}/slide_${String(i).padStart(2, "0")}.png`;
      const { url } = await uploadPng({
        bucket: STORAGE_BUCKET,
        path,
        data: png,
        upsert: true,
      });
      updatedSlides[i] = {
        ...slide,
        rendered_url: url,
        rendered_at: new Date().toISOString(),
      } as SlideData;
      outputUrls.push(url);
      logger.info({ postId: post.id, i, url }, "render-slide: ok");
    } catch (err) {
      logger.error(
        { postId: post.id, i, err: (err as Error).message },
        "render-slide: failed for index",
      );
      // Don't fail the whole job for one slide — continue rendering the rest
    }
  }

  if (outputUrls.length === 0) {
    await markFailed(job.id, "all slides failed to render");
    return;
  }

  // Patch post: slides_config + cover image + storage prefix + status
  await pool.query(
    `UPDATE public.creator_posts
        SET slides_config = $2::jsonb,
            slides_storage_prefix = $3,
            cover_image_url = $4,
            status = CASE
              WHEN status = 'copy_approved' THEN 'design_review'::public.creator_post_status
              ELSE status
            END,
            updated_at = now()
      WHERE id = $1`,
    [
      post.id,
      JSON.stringify(updatedSlides),
      prefix,
      updatedSlides[0]?.rendered_url ?? null,
    ],
  );

  await pool.query(
    `UPDATE public.creator_render_jobs
        SET status = 'completed',
            output_urls = $2,
            completed_at = now()
      WHERE id = $1`,
    [job.id, outputUrls],
  );

  logger.info(
    {
      jobId: job.id,
      postId: post.id,
      slidesRendered: outputUrls.length,
      totalSlides: targetIndexes.length,
      latencyMs: Date.now() - startedAt,
    },
    "render-slide: job done",
  );
}

async function markFailed(jobId: string, error: string) {
  const pool = getPool();
  await pool.query(
    `UPDATE public.creator_render_jobs
        SET status = CASE
              WHEN attempts >= max_attempts THEN 'failed'::public.creator_render_status
              ELSE 'pending'::public.creator_render_status
            END,
            error = $2,
            leased_at = NULL,
            leased_by = NULL
      WHERE id = $1`,
    [jobId, error],
  );
}
