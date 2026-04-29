/**
 * Studio Automation handler — pins a configured comment under a published
 * video using Playwright + the company's stored cookie session.
 *
 * Inputs (job.payload): { video_id: string, comment: string }
 * Side-effects:
 *   • Updates youtube_projects.studio_status / studio_completed_at / studio_error
 *   • Marks youtube_studio_sessions.invalid=true on auth errors so the user
 *     gets a "reconnect Studio" CTA in the UI before the next job tries.
 */

import type pg from "pg";
import { decryptString } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  pinComment,
  StudioAuthError,
  type StudioCookie,
} from "../services/studio-playwright.js";

interface StudioJob {
  id: string;
  company_id: string;
  project_id: string;
  kind: "pin_comment";
  payload: { video_id?: string; comment?: string };
  attempts: number;
  max_attempts: number;
}

interface StudioSessionRow {
  cookies_encrypted: string;
  invalid: boolean;
}

export async function handleStudioJob(
  pool: pg.Pool,
  job: StudioJob,
): Promise<void> {
  if (job.kind !== "pin_comment") {
    await failJob(pool, job, `unsupported kind: ${job.kind}`, true);
    return;
  }

  const videoId = job.payload.video_id;
  const comment = job.payload.comment;
  if (!videoId || !comment) {
    await failJob(pool, job, "payload missing video_id or comment", true);
    return;
  }

  // Mark project running
  await pool.query(
    `UPDATE public.youtube_projects
        SET studio_status = 'running', updated_at = now()
      WHERE id = $1 AND company_id = $2`,
    [job.project_id, job.company_id],
  );

  // Load cookies
  const sR = await pool.query<StudioSessionRow>(
    `SELECT cookies_encrypted, invalid
       FROM public.youtube_studio_sessions
      WHERE company_id = $1`,
    [job.company_id],
  );
  const session = sR.rows[0];
  if (!session) {
    await failJob(pool, job, "studio session missing", true);
    await markProjectStudio(pool, job, "failed", "studio session missing");
    return;
  }
  if (session.invalid) {
    await failJob(pool, job, "studio session invalid", true);
    await markProjectStudio(pool, job, "failed", "reconnect Studio cookies");
    return;
  }

  let cookies: StudioCookie[];
  try {
    cookies = JSON.parse(decryptString(session.cookies_encrypted)) as StudioCookie[];
  } catch (err) {
    await failJob(pool, job, `decrypt failed: ${(err as Error).message}`, true);
    await markProjectStudio(pool, job, "failed", "cookie decrypt failed");
    return;
  }

  // Run Playwright
  try {
    const result = await pinComment({ videoId, comment, cookies });

    await pool.query(
      `UPDATE public.youtube_studio_jobs
          SET status = 'completed'::public.youtube_studio_job_status,
              result = $2::jsonb,
              completed_at = now(),
              error = NULL,
              leased_at = NULL,
              leased_by = NULL,
              updated_at = now()
        WHERE id = $1`,
      [job.id, JSON.stringify(result)],
    );
    await pool.query(
      `UPDATE public.youtube_projects
          SET studio_status = 'completed',
              studio_error = NULL,
              studio_completed_at = now(),
              pinned_comment_status = 'pinned',
              pinned_comment_error = NULL,
              updated_at = now()
        WHERE id = $1`,
      [job.project_id],
    );
    // Bump session.last_validated_at so the UI knows cookies are still good
    await pool.query(
      `UPDATE public.youtube_studio_sessions
          SET last_validated_at = now(), updated_at = now()
        WHERE company_id = $1`,
      [job.company_id],
    );
    logger.info(
      { jobId: job.id, projectId: job.project_id, videoId },
      "studio-automation: pinned",
    );
  } catch (err) {
    if (err instanceof StudioAuthError) {
      await pool.query(
        `UPDATE public.youtube_studio_sessions
            SET invalid = true, invalid_reason = $2, updated_at = now()
          WHERE company_id = $1`,
        [job.company_id, err.message.slice(0, 200)],
      );
      await failJob(pool, job, `auth: ${err.message}`, true);
      await markProjectStudio(pool, job, "failed", "Studio cookies expired — reconnect");
      return;
    }
    // Transient (selectors stale, network) — let it retry until max_attempts
    const exhausted = job.attempts >= job.max_attempts;
    await failJob(pool, job, (err as Error).message, exhausted);
    if (exhausted) {
      await markProjectStudio(
        pool,
        job,
        "failed",
        (err as Error).message.slice(0, 500),
      );
    }
    logger.warn(
      {
        jobId: job.id,
        attempts: job.attempts,
        exhausted,
        err: (err as Error).message,
      },
      "studio-automation: pin failed",
    );
  }
}

async function failJob(
  pool: pg.Pool,
  job: StudioJob,
  reason: string,
  terminal: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE public.youtube_studio_jobs
        SET status = CASE
              WHEN $3::boolean THEN 'failed'::public.youtube_studio_job_status
              ELSE 'queued'::public.youtube_studio_job_status
            END,
            error = $2,
            leased_at = NULL,
            leased_by = NULL,
            completed_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [job.id, reason.slice(0, 1000), terminal],
  );
}

async function markProjectStudio(
  pool: pg.Pool,
  job: StudioJob,
  status: "running" | "completed" | "failed",
  error: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE public.youtube_projects
        SET studio_status = $2,
            studio_error = $3,
            studio_completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE studio_completed_at END,
            updated_at = now()
      WHERE id = $1`,
    [job.project_id, status, error],
  );
}
