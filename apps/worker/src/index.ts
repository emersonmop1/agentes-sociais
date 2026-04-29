/**
 * Worker main loop. Polls creator_render_jobs (and later creator_publish_jobs)
 * via SELECT ... FOR UPDATE SKIP LOCKED through fn_lease_next_render_job.
 *
 * Concurrency: up to RENDER_CONCURRENCY simultaneous renders within this
 * process. Multiple worker processes are safe — the SKIP LOCKED lease
 * guarantees only one process picks each job.
 */

import { closePool, getPool } from "./db.js";
import { loadEnv } from "./env.js";
import { captureException, flushSentry, initSentry } from "./lib/sentry.js";
import { handleGenerateThumbnailsJob } from "./handlers/generate-thumbnails.js";
import { pollEngagementTick } from "./handlers/poll-engagement.js";
import { handlePublishJob } from "./handlers/publish-instagram.js";
import { handlePublishYouTubeJob } from "./handlers/publish-youtube.js";
import { handleRenderJob } from "./handlers/render-slide.js";
import { handleStudioJob } from "./handlers/studio-automation.js";
import { logger } from "./lib/logger.js";
import { shutdownBrowser } from "./services/carousel-renderer.js";
import { shutdownStudioBrowser } from "./services/studio-playwright.js";

initSentry();
const env = loadEnv();
let stopping = false;

logger.info({ workerId: env.WORKER_ID, concurrency: env.RENDER_CONCURRENCY }, "worker starting");

let activeRenders = 0;
let activePublishes = 0;
let activeThumbs = 0;
let activeYTPublishes = 0;
let activeStudio = 0;

async function leaseAndRunStudio(): Promise<boolean> {
  // Studio jobs are slow (Playwright + browser cold-start latency) and
  // hammer YouTube — sequential per process, max 1 concurrent. Multiple
  // worker processes are still safe via FOR UPDATE SKIP LOCKED.
  if (activeStudio >= 1) return false;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM public.fn_lease_next_youtube_studio_job($1)`,
    [env.WORKER_ID],
  );
  const job = r.rows[0];
  if (!job || !job.id) return false;

  activeStudio += 1;
  void (async () => {
    try {
      logger.info(
        { jobId: job.id, projectId: job.project_id, kind: job.kind },
        "studio-automation: leased",
      );
      await handleStudioJob(pool, job);
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "studio-automation: handler threw",
      );
      captureException(err, {
        tags: {
          handler: "studio-automation",
          job_id: job.id,
          project_id: job.project_id ?? "",
          kind: job.kind ?? "",
        },
      });
      await pool.query(
        `UPDATE public.youtube_studio_jobs
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'failed'::public.youtube_studio_job_status
                  ELSE 'queued'::public.youtube_studio_job_status
                END,
                error = $2,
                leased_at = NULL,
                leased_by = NULL,
                updated_at = now()
          WHERE id = $1`,
        [job.id, (err as Error).message.slice(0, 1000)],
      ).catch(() => undefined);
    } finally {
      activeStudio -= 1;
    }
  })();
  return true;
}

async function leaseAndRunYTPublish(): Promise<boolean> {
  // Sequential — uploads are heavy I/O and we want to avoid bursting Google quota
  if (activeYTPublishes >= 1) return false;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM public.fn_lease_next_youtube_publish_job($1)`,
    [env.WORKER_ID],
  );
  const job = r.rows[0];
  if (!job || !job.id) return false;

  activeYTPublishes += 1;
  void (async () => {
    try {
      logger.info({ jobId: job.id, projectId: job.project_id }, "publish-youtube: leased");
      await handlePublishYouTubeJob(job);
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "publish-youtube: handler threw",
      );
      captureException(err, {
        tags: {
          handler: "publish-youtube",
          job_id: job.id,
          project_id: job.project_id ?? "",
        },
      });
      await pool.query(
        `UPDATE public.youtube_publish_jobs
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'failed'::public.youtube_publish_status
                  ELSE 'queued'::public.youtube_publish_status
                END,
                error = $2,
                leased_at = NULL,
                leased_by = NULL
          WHERE id = $1`,
        [job.id, (err as Error).message.slice(0, 1000)],
      ).catch(() => undefined);
    } finally {
      activeYTPublishes -= 1;
    }
  })();
  return true;
}

async function leaseAndRunThumbs(): Promise<boolean> {
  if (activeThumbs >= 2) return false;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM public.fn_lease_next_youtube_thumb_job($1)`,
    [env.WORKER_ID],
  );
  const job = r.rows[0];
  if (!job || !job.id) return false;

  activeThumbs += 1;
  void (async () => {
    try {
      logger.info({ jobId: job.id, projectId: job.project_id }, "youtube-thumbs: leased");
      await handleGenerateThumbnailsJob(job);
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "youtube-thumbs: handler threw",
      );
      captureException(err, {
        tags: {
          handler: "youtube-thumbs",
          job_id: job.id,
          project_id: job.project_id ?? "",
        },
      });
      await pool.query(
        `UPDATE public.youtube_thumbnail_jobs
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'failed'::public.youtube_thumb_job_status
                  ELSE 'pending'::public.youtube_thumb_job_status
                END,
                error = $2,
                leased_at = NULL,
                leased_by = NULL
          WHERE id = $1`,
        [job.id, (err as Error).message.slice(0, 1000)],
      ).catch(() => undefined);
    } finally {
      activeThumbs -= 1;
    }
  })();
  return true;
}

async function leaseAndRunPublish(): Promise<boolean> {
  // Publishes are I/O-bound (Graph API). Run a small concurrency cap.
  if (activePublishes >= 3) return false;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM public.fn_lease_next_publish_job($1)`,
    [env.WORKER_ID],
  );
  const job = r.rows[0];
  if (!job || !job.id) return false;

  activePublishes += 1;
  void (async () => {
    try {
      logger.info({ jobId: job.id, postId: job.post_id }, "publish-instagram: leased");
      await handlePublishJob(job);
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "publish-instagram: handler threw",
      );
      captureException(err, {
        tags: {
          handler: "publish-instagram",
          job_id: job.id,
          post_id: job.post_id ?? "",
        },
      });
      await pool.query(
        `UPDATE public.creator_publish_jobs
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'failed'::public.creator_publish_status
                  ELSE 'queued'::public.creator_publish_status
                END,
                error = $2,
                leased_at = NULL,
                leased_by = NULL
          WHERE id = $1`,
        [job.id, (err as Error).message.slice(0, 1000)],
      ).catch(() => undefined);
    } finally {
      activePublishes -= 1;
    }
  })();
  return true;
}

async function leaseAndRunRender(): Promise<boolean> {
  if (activeRenders >= env.RENDER_CONCURRENCY) return false;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM public.fn_lease_next_render_job($1)`,
    [env.WORKER_ID],
  );
  const job = r.rows[0];
  if (!job || !job.id) return false;

  activeRenders += 1;
  void (async () => {
    try {
      logger.info({ jobId: job.id, postId: job.post_id }, "render-slide: leased");
      await handleRenderJob(job);
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "render-slide: handler threw",
      );
      captureException(err, {
        tags: {
          handler: "render-slide",
          job_id: job.id,
          post_id: job.post_id ?? "",
        },
      });
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
        [job.id, (err as Error).message.slice(0, 1000)],
      ).catch(() => undefined);
    } finally {
      activeRenders -= 1;
    }
  })();
  return true;
}

// Engagement poller runs on its own cadence (5 min) so we don't hit Graph
// API every poll tick. Tracked here so multiple pollLoop iterations share state.
let lastEngagementTickAt = 0;
const ENGAGEMENT_TICK_INTERVAL_MS = 5 * 60 * 1000;

async function maybeRunEngagementTick(): Promise<void> {
  if (Date.now() - lastEngagementTickAt < ENGAGEMENT_TICK_INTERVAL_MS) return;
  lastEngagementTickAt = Date.now();
  try {
    const polled = await pollEngagementTick(getPool());
    if (polled > 0) {
      logger.info({ polled }, "poll-engagement: tick complete");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "poll-engagement: tick errored");
    captureException(err, { tags: { handler: "poll-engagement" } });
  }
}

async function pollLoop() {
  while (!stopping) {
    try {
      // Burst-lease as many jobs as concurrency allows
      let leased = 0;
      while (await leaseAndRunRender()) leased += 1;
      while (await leaseAndRunPublish()) leased += 1;
      while (await leaseAndRunThumbs()) leased += 1;
      while (await leaseAndRunYTPublish()) leased += 1;
      while (await leaseAndRunStudio()) leased += 1;

      // Background-cadence work — runs at most every ENGAGEMENT_TICK_INTERVAL_MS
      void maybeRunEngagementTick();

      if (leased === 0) {
        await sleep(env.POLL_INTERVAL_MS);
      } else {
        await sleep(50);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "poll loop error");
      await sleep(2000);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutting down");
  // Wait for active jobs to drain (max 30s)
  const deadline = Date.now() + 30_000;
  while (
    (activeRenders > 0 ||
      activePublishes > 0 ||
      activeThumbs > 0 ||
      activeYTPublishes > 0 ||
      activeStudio > 0) &&
    Date.now() < deadline
  ) {
    logger.info(
      { activeRenders, activePublishes, activeThumbs, activeYTPublishes, activeStudio },
      "waiting for jobs to drain",
    );
    await sleep(500);
  }
  await shutdownBrowser();
  await shutdownStudioBrowser();
  await flushSentry();
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void pollLoop();
