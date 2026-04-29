/**
 * Sentry init for the web app. No-op when VITE_SENTRY_DSN is unset.
 *
 * Init must run before any React tree is mounted so Sentry's auto-instrument
 * picks up route changes and unhandled rejections.
 */

import * as Sentry from "@sentry/react";
import { env } from "./env";

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  _initialized = true;
  if (!env.SENTRY_DSN) {
    if (env.SENTRY_ENVIRONMENT !== "production") {
      // eslint-disable-next-line no-console
      console.debug("[sentry] DSN not set, capture disabled");
    }
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    /**
     * Don't ship the full URL — query strings can carry signed Supabase
     * tokens during OAuth round-trips.
     */
    beforeSend(event) {
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          event.request.url = `${u.origin}${u.pathname}`;
        } catch {
          /* leave as-is */
        }
      }
      return event;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
export const captureException = Sentry.captureException;
