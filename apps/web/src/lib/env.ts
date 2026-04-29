/**
 * Reads VITE_* env vars at build time. For runtime override (e.g. swap the
 * API URL at deploy time without rebuild), Fatia 10 will add window.__ENV__
 * injection like Masi does.
 */
export const env = {
  API_URL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ?? "",
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  // Optional — when unset, the Sentry boot is a no-op and ErrorBoundary
  // still works locally without any network capture.
  SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN ?? "",
  SENTRY_ENVIRONMENT:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE ?? "development",
};

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  // Don't crash dev — let the dev see the warning and fix .env.
  console.warn(
    "[env] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. Auth will not work.",
  );
}
