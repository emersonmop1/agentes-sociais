/**
 * Sentry init for the API process. No-op when SENTRY_DSN is unset, so dev
 * + tests + forks without secrets don't pay any cost.
 *
 * Why we wrap @sentry/node behind helpers instead of calling Sentry.* from
 * everywhere:
 *   • Swap to OTel later without touching every callsite.
 *   • Keep init in one spot (must run before app code imports).
 *   • Test code can `vi.mock` this module to assert capture calls.
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
    /**
     * Sensitive payloads land in DB rows we send via captureException — drop
     * them before they leave the process. Mostly defensive: our error paths
     * already don't include token strings, but a stray field could leak.
     */
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
    { environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV },
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

export function setRequestContext(args: {
  userId?: string;
  companyId?: string;
  path?: string;
}): void {
  if (!_initialized) return;
  Sentry.getCurrentScope().setUser(args.userId ? { id: args.userId } : null);
  if (args.companyId) Sentry.getCurrentScope().setTag("company_id", args.companyId);
  if (args.path) Sentry.getCurrentScope().setTag("http.path", args.path);
}

/**
 * Flush pending events before process exit. The handlers must call this
 * during graceful shutdown so we don't lose the last few seconds of data.
 */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!_initialized) return;
  await Sentry.flush(timeoutMs);
}
