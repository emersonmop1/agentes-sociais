import type { MiddlewareHandler } from "hono";

interface Bucket {
  tokens: number;
  resetAt: number;
}

/**
 * In-memory token bucket rate limiter.
 *
 * Suitable for single-instance API. When we scale to multiple Fly machines
 * behind a load balancer this needs to move to Postgres or Redis — the
 * single-instance window is fine for v1.
 */
export function rateLimit(opts: {
  /** Per-window request budget */
  limit: number;
  /** Window in ms */
  windowMs: number;
  /** Function to derive a key per request (default: IP) */
  keyFn?: (c: import("hono").Context) => string;
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyFn =
    opts.keyFn ??
    ((c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown");

  // Periodically prune expired buckets (every 5 min).
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, 5 * 60 * 1000).unref();

  return async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { tokens: opts.limit - 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        { error: "rate_limited", message: "Too many requests" },
        429,
      );
    }

    bucket.tokens -= 1;
    return next();
  };
}
