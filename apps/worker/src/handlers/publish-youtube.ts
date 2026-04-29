/**
 * publish-youtube handler — leases a youtube_publish_jobs row, refreshes the
 * Google access token, uploads the video, sets the chosen thumbnail, and
 * marks the project as published.
 *
 * Retry policy mirrors publish-instagram:
 *   • Auth errors (refresh failed, scope revoked): mark token invalid + fail
 *     job immediately. User must reconnect.
 *   • Quota errors: mark failed + don't retry (quota resets daily).
 *   • Validation 4xx: fail without retry.
 *   • Transient (5xx, network, video fetch): retry up to max_attempts.
 */

import { getPool } from "../db.js";
import { decryptString, encryptString } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  YouTubeAPIError,
  insertVideo,
  refreshAccessToken,
  setThumbnail,
} from "../services/youtube-data-api.js";

interface PublishJobRow {
  id: string;
  project_id: string;
  company_id: string;
  scheduled_for: string | null;
  privacy_status: "private" | "unlisted" | "public";
  status: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
}

interface ProjectRow {
  id: string;
  company_id: string;
  status: string;
  chosen_title: string | null;
  description: string | null;
  tags: string[];
  storage_video_url: string | null;
  thumbnail_urls: string[];
  chosen_thumbnail_idx: number | null;
}

interface IntegrationRow {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  invalid: boolean;
}

export async function handlePublishYouTubeJob(job: PublishJobRow): Promise<void> {
  const pool = getPool();
  const startedAt = Date.now();

  // 1. Load project
  const projectR = await pool.query<ProjectRow>(
    `SELECT id, company_id, status, chosen_title, description, tags,
            storage_video_url, thumbnail_urls, chosen_thumbnail_idx
       FROM public.youtube_projects WHERE id = $1`,
    [job.project_id],
  );
  const project = projectR.rows[0];
  if (!project) {
    await failJob(job.id, "project_not_found", false);
    return;
  }
  if (!project.chosen_title) {
    await failJob(job.id, "no_title", false);
    await markProjectPublishFailed(project.id, "missing chosen_title");
    return;
  }
  if (!project.storage_video_url) {
    await failJob(job.id, "no_video_url", false);
    await markProjectPublishFailed(project.id, "missing storage_video_url");
    return;
  }

  // 2. Load + maybe refresh token
  const tokR = await pool.query<IntegrationRow>(
    `SELECT access_token_encrypted, refresh_token_encrypted, expires_at, invalid
       FROM public.integration_tokens
      WHERE company_id = $1 AND provider = 'youtube'`,
    [project.company_id],
  );
  const tk = tokR.rows[0];
  if (!tk) {
    await failJob(job.id, "youtube_not_connected", false);
    await markProjectPublishFailed(project.id, "youtube not connected");
    return;
  }
  if (tk.invalid) {
    await failJob(job.id, "youtube token marked invalid", false);
    await markProjectPublishFailed(project.id, "reconnect youtube");
    return;
  }
  if (!tk.refresh_token_encrypted) {
    await failJob(job.id, "no refresh_token stored", false);
    await markProjectPublishFailed(project.id, "missing refresh_token; reconnect");
    return;
  }

  let accessToken: string;
  try {
    // Always refresh. Access tokens are 1h and may already be expired by the
    // time we lease this job (especially if it was scheduled far in advance).
    const refreshToken = decryptString(tk.refresh_token_encrypted);
    const fresh = await refreshAccessToken(refreshToken);
    accessToken = fresh.accessToken;
    // Persist the refreshed access token (best effort)
    await pool.query(
      `UPDATE public.integration_tokens
          SET access_token_encrypted = $2,
              expires_at = $3,
              refreshed_at = now(),
              updated_at = now()
        WHERE company_id = $1 AND provider = 'youtube'`,
      [project.company_id, encryptString(fresh.accessToken), fresh.expiresAt.toISOString()],
    ).catch(() => undefined);
  } catch (err) {
    const isAuth = (err as Error & { isAuthError?: boolean }).isAuthError;
    if (isAuth) {
      await pool.query(
        `UPDATE public.integration_tokens
            SET invalid = true, invalid_reason = $2, updated_at = now()
          WHERE company_id = $1 AND provider = 'youtube'`,
        [project.company_id, (err as Error).message.slice(0, 1000)],
      );
      await failJob(job.id, "auth refresh failed", false);
      await markProjectPublishFailed(project.id, "youtube auth expired — reconnect");
      return;
    }
    await failJob(job.id, `refresh failed: ${(err as Error).message}`, true);
    return;
  }

  // 3. Insert video
  let video;
  try {
    video = await insertVideo({
      accessToken,
      videoUrl: project.storage_video_url,
      title: project.chosen_title,
      description: project.description ?? "",
      tags: project.tags,
      privacyStatus: job.privacy_status,
      publishAt: job.scheduled_for ?? undefined,
    });
  } catch (err) {
    if (err instanceof YouTubeAPIError) {
      if (err.isAuthError) {
        // Auth blew up mid-upload; same handling as refresh failure.
        await pool.query(
          `UPDATE public.integration_tokens
              SET invalid = true, invalid_reason = $2, updated_at = now()
            WHERE company_id = $1 AND provider = 'youtube'`,
          [project.company_id, err.message.slice(0, 1000)],
        );
        await failJob(job.id, `auth: ${err.message}`, false);
        await markProjectPublishFailed(project.id, "youtube auth — reconnect");
        return;
      }
      if (err.isQuotaError) {
        await failJob(job.id, `quota: ${err.message}`, false);
        await markProjectPublishFailed(project.id, "youtube quota exceeded");
        return;
      }
      if (err.status >= 400 && err.status < 500) {
        await failJob(job.id, err.message, false);
        await markProjectPublishFailed(project.id, err.message);
        return;
      }
    }
    const retryable = job.attempts < job.max_attempts;
    await failJob(job.id, (err as Error).message, retryable);
    if (!retryable) {
      await markProjectPublishFailed(project.id, (err as Error).message);
    }
    logger.warn(
      { jobId: job.id, attempts: job.attempts, retryable, err: (err as Error).message },
      "publish-youtube: transient error",
    );
    return;
  }

  // 4. Set thumbnail (best effort — don't fail the whole publish if it fails)
  if (project.chosen_thumbnail_idx !== null) {
    const thumbUrl = project.thumbnail_urls[project.chosen_thumbnail_idx];
    if (thumbUrl) {
      try {
        await setThumbnail({
          accessToken,
          videoId: video.id,
          thumbnailUrl: thumbUrl,
        });
      } catch (err) {
        logger.warn(
          { videoId: video.id, err: (err as Error).message },
          "thumbnail set failed (non-fatal)",
        );
      }
    }
  }

  // 5. Mark project + job as published
  const ytUrl = `https://youtube.com/watch?v=${video.id}`;
  await pool.query(
    `UPDATE public.youtube_projects
        SET status = 'published'::public.youtube_project_status,
            published_at = now(),
            youtube_video_id = $2,
            youtube_url = $3,
            publish_error = NULL,
            updated_at = now()
      WHERE id = $1`,
    [project.id, video.id, ytUrl],
  );
  await pool.query(
    `UPDATE public.youtube_publish_jobs
        SET status = 'completed'::public.youtube_publish_status,
            error = NULL,
            external_response = $2::jsonb,
            completed_at = now()
      WHERE id = $1`,
    [job.id, JSON.stringify({ video_id: video.id, url: ytUrl, snippet: video.snippet })],
  );

  logger.info(
    {
      jobId: job.id,
      projectId: project.id,
      videoId: video.id,
      latencyMs: Date.now() - startedAt,
    },
    "publish-youtube: ok",
  );
}

async function failJob(jobId: string, reason: string, retryable: boolean): Promise<void> {
  const pool = getPool();
  if (retryable) {
    await pool.query(
      `UPDATE public.youtube_publish_jobs
          SET status = 'queued'::public.youtube_publish_status,
              error = $2,
              leased_at = NULL,
              leased_by = NULL
        WHERE id = $1`,
      [jobId, reason.slice(0, 1000)],
    );
  } else {
    await pool.query(
      `UPDATE public.youtube_publish_jobs
          SET status = 'failed'::public.youtube_publish_status,
              error = $2,
              completed_at = now()
        WHERE id = $1`,
      [jobId, reason.slice(0, 1000)],
    );
  }
}

async function markProjectPublishFailed(projectId: string, reason: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE public.youtube_projects
        SET status = 'publish_failed'::public.youtube_project_status,
            publish_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [projectId, reason.slice(0, 1000)],
  );
}
