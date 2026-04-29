/**
 * Sentry init for the worker process. No-op when SENTRY_DSN is unset.
 *
 * Worker errors come in two shapes:
 *   • Handler threw — captured by leaseAndRun*() in index.ts, then forwarded
 *     here with job tags (job_id, kind, project_id/post_id) for filtering.
 *   • Engagement tick / Studio tick errors — reported separately.
 */

import * as Sentry from "@sentry/node";
import { loadEnv } from "../env.js";
import { logger } from "./logger.js";

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  _initialized = true;
  const env = loadEnv();
  if (!env.SENTRY_DSN) {
    logger.debug("sentry: DSN not set, capture disabled");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    sampleRate: env.SENTRY_SAMPLE_RATE,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    initialScope: {
      tags: {
        process: "worker",
        worker_id: env.WORKER_ID,
      },
    },
    beforeSend(event) {
      if (event.extra && typeof event.extra === "object") {
        for (const key of Object.keys(event.extra)) {
          if (/token|secret|password|cookie/i.test(key)) {
            event.extra[key] = "[redacted]";
          }
        }
      }
      return event;
    },
  });

  logger.info(
    { workerId: env.WORKER_ID, environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV },
    "sentry: initialized",
  );
}

export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!_initialized) return;
  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) {
        scope.setTag(k, v);
      }
    }
    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err);
  });
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!_initialized) return;
  await Sentry.flush(timeoutMs);
}
