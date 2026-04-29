/**
 * Hono app builder. Lives separate from index.ts so tests can import it
 * without booting the network listener (or signal handlers).
 *
 * index.ts wraps this with @hono/node-server.serve() + graceful shutdown.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { pingDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { logger } from "./lib/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { resolveCompany } from "./middleware/company.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { agentsRoutes } from "./modules/agents/routes.js";
import { companiesRoutes } from "./modules/companies/routes.js";
import { instaCreatorRoutes } from "./modules/insta-creator/routes.js";
import {
  integrationsPublicRoutes,
  integrationsRoutes,
} from "./modules/integrations/routes.js";
import { inviteRoutes, ownerInviteRoutes } from "./modules/invites/routes.js";
import { onboardingRoutes } from "./modules/onboarding/routes.js";
import { reelsRoutes } from "./modules/reels/routes.js";
import { youtubeRoutes } from "./modules/youtube/routes.js";

export function buildApp() {
  const env = loadEnv();
  const app = new Hono();

  // ─── Global middleware ──────────────────────────────────────────────────
  app.use("*", honoLogger((line) => logger.info(line.trim())));
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: env.WEB_PUBLIC_URL,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Company-Id"],
      exposeHeaders: ["Retry-After"],
      maxAge: 600,
    }),
  );

  // Global IP-based rate limit. Per-user limits live on individual routes.
  app.use("/api/*", rateLimit({ limit: 120, windowMs: 60_000 }));

  // ─── Public routes ──────────────────────────────────────────────────────
  app.get("/api/health", async (c) => {
    const dbOk = await pingDb();
    return c.json({
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      version: "0.1.0",
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (c) =>
    c.json({
      name: "agentes-sociais API",
      docs: "/api/health",
    }),
  );

  // OAuth callbacks — public (Facebook/Google won't carry our JWT)
  app.route("/api/integrations", integrationsPublicRoutes);

  // ─── Authenticated routes ───────────────────────────────────────────────
  const authed = new Hono();
  authed.use("*", requireAuth, resolveCompany);

  authed.get("/me", (c) => {
    const auth = c.var.auth;
    const company = c.var.company;
    return c.json({
      user: { id: auth.userId, email: auth.email },
      company: { id: company.companyId, role: company.role },
    });
  });

  authed.route("/onboarding", onboardingRoutes);
  authed.route("/agents", agentsRoutes);
  authed.route("/companies", companiesRoutes);
  authed.route("/companies/me/invites", ownerInviteRoutes);
  authed.route("/invites", inviteRoutes);
  authed.route("/insta-creator", instaCreatorRoutes);
  authed.route("/integrations", integrationsRoutes);
  authed.route("/reels", reelsRoutes);
  authed.route("/youtube", youtubeRoutes);

  app.route("/api", authed);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}
