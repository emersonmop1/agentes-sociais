import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  /** Worker identity, included in agent_jobs.leased_by for debugging. */
  WORKER_ID: z.string().default(`worker-${process.pid}`),

  /** Polling interval. */
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),

  /** Max concurrent renders within one worker process. */
  RENDER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Observability (optional — Sentry no-op when unset)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),
});

export type Env = z.infer<typeof envSchema>;
let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
