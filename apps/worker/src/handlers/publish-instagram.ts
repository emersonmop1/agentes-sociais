/**
 * publish-instagram handler — leases creator_publish_jobs, decrypts token,
 * calls Graph API, updates post status.
 *
 * Retry policy:
 *   • Auth errors (token revoked / expired): mark token invalid + fail job
 *     immediately (no retry — needs user reconnect).
 *   • Validation errors (4xx other): fail without retry.
 *   • Transient (5xx, network): retry up to max_attempts with backoff.
 */

import { getPool } from "../db.js";
import { decryptString } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  GraphAPIError,
  publishCarousel,
} from "../services/instagram-graph.js";

interface PublishJobRow {
  id: string;
  post_id: string;
  company_id: string;
  publisher: "graph_api";
  scheduled_for: string | null;
  status: "queued" | "publishing" | "completed" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  error: string | null;
}

interface CreatorPostRow {
  id: string;
  company_id: string;
  status: string;
  caption: string | null;
  first_comment: string | null;
  slides_config: Array<{ index: number; rendered_url?: string | null }>;
}

interface IntegrationTokenRow {
  access_token_encrypted: string;
  metadata: { ig_user_id?: string; ig_username?: string };
  invalid: boolean;
}

export async function handlePublishJob(job: PublishJobRow): Promise<void> {
  const pool = getPool();
  const startedAt = Date.now();

  // Load post
  const postR = await pool.query<CreatorPostRow>(
    `SELECT id, company_id, status, caption, first_comment, slides_config
       FROM public.creator_posts WHERE id = $1`,
    [job.post_id],
  );
  const post = postR.rows[0];
  if (!post) {
    await failJob(job.id, "post_not_found", false);
    return;
  }

  if (!post.caption || post.caption.trim().length === 0) {
    await failJob(job.id, "post has no caption", false);
    await transitionPost(post.id, "publish_failed", "missing caption");
    return;
  }

  const orderedSlides = [...post.slides_config].sort((a, b) => a.index - b.index);
  const imageUrls = orderedSlides.map((s) => s.rendered_url).filter((u): u is string => Boolean(u));
  if (imageUrls.length === 0 || imageUrls.length !== post.slides_config.length) {
    await failJob(job.id, "not all slides have rendered_url", false);
    await transitionPost(post.id, "publish_failed", "slides not fully rendered");
    return;
  }

  // Load token
  const tokR = await pool.query<IntegrationTokenRow>(
    `SELECT access_token_encrypted, metadata, invalid
       FROM public.integration_tokens
      WHERE company_id = $1 AND provider = 'instagram_graph'`,
    [post.company_id],
  );
  const tk = tokR.rows[0];
  if (!tk) {
    await failJob(job.id, "instagram not connected", false);
    await transitionPost(post.id, "publish_failed", "instagram not connected");
    return;
  }
  if (tk.invalid) {
    await failJob(job.id, "instagram token marked invalid", false);
    await transitionPost(post.id, "publish_failed", "reconnect instagram");
    return;
  }
  const igUserId = tk.metadata?.ig_user_id;
  if (!igUserId) {
    await failJob(job.id, "ig_user_id missing in token metadata", false);
    return;
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decryptString(tk.access_token_encrypted);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "token decrypt failed");
    await failJob(job.id, "token decryption failed", false);
    return;
  }

  // Publish
  try {
    const result = await publishCarousel({
      igUserId,
      pageAccessToken,
      imageUrls,
      caption: post.caption,
      firstComment: post.first_comment,
    });

    // Mark post + job as published
    await pool.query(
      `UPDATE public.creator_posts
          SET status = 'published'::public.creator_post_status,
              published_at = now(),
              external_post_id = $2,
              external_post_url = $3,
              publish_error = NULL,
              updated_at = now()
        WHERE id = $1`,
      [post.id, result.mediaId, result.permalink ?? null],
    );
    await pool.query(
      `UPDATE public.creator_publish_jobs
          SET status = 'completed'::public.creator_publish_status,
              error = NULL,
              external_response = $2::jsonb,
              completed_at = now()
        WHERE id = $1`,
      [job.id, JSON.stringify({ media_id: result.mediaId, permalink: result.permalink ?? null })],
    );

    logger.info(
      { jobId: job.id, postId: post.id, mediaId: result.mediaId, latencyMs: Date.now() - startedAt },
      "publish-instagram: ok",
    );
  } catch (err) {
    if (err instanceof GraphAPIError) {
      if (err.isAuthError) {
        // Mark token invalid — user needs to reconnect.
        await pool.query(
          `UPDATE public.integration_tokens
              SET invalid = true,
                  invalid_reason = $2
            WHERE company_id = $1 AND provider = 'instagram_graph'`,
          [post.company_id, err.message.slice(0, 1000)],
        );
        await failJob(job.id, `auth: ${err.message}`, false);
        await transitionPost(post.id, "publish_failed", "instagram auth expired — reconnect");
        return;
      }
      if (err.status >= 400 && err.status < 500) {
        // Validation/policy issue — don't retry
        await failJob(job.id, err.message, false);
        await transitionPost(post.id, "publish_failed", err.message);
        return;
      }
    }

    // Transient — let the lease decay so we retry on next poll
    const retryable = job.attempts < job.max_attempts;
    await failJob(job.id, (err as Error).message, retryable);
    if (!retryable) {
      await transitionPost(post.id, "publish_failed", (err as Error).message);
    }
    logger.warn(
      { jobId: job.id, attempts: job.attempts, retryable, err: (err as Error).message },
      "publish-instagram: transient error",
    );
  }
}

async function failJob(jobId: string, reason: string, retryable: boolean): Promise<void> {
  const pool = getPool();
  if (retryable) {
    // Reset to queued so the lease helper picks it up again on next tick
    await pool.query(
      `UPDATE public.creator_publish_jobs
          SET status = 'queued'::public.creator_publish_status,
              error = $2,
              leased_at = NULL,
              leased_by = NULL
        WHERE id = $1`,
      [jobId, reason.slice(0, 1000)],
    );
  } else {
    await pool.query(
      `UPDATE public.creator_publish_jobs
          SET status = 'failed'::public.creator_publish_status,
              error = $2,
              completed_at = now()
        WHERE id = $1`,
      [jobId, reason.slice(0, 1000)],
    );
  }
}

async function transitionPost(postId: string, status: string, error: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE public.creator_posts
        SET status = $2::public.creator_post_status,
            publish_error = $3,
            updated_at = now()
      WHERE id = $1`,
    [postId, status, error.slice(0, 1000)],
  );
}
