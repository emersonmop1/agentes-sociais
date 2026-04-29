import { serve } from "@hono/node-server";

import { buildApp } from "./app.js";
import { closePool } from "./db/client.js";
import { loadEnv } from "./env.js";
import { logger } from "./lib/logger.js";
import { flushSentry, initSentry } from "./lib/sentry.js";

// Init must run before buildApp() — Sentry instruments handles via Node hooks.
initSentry();

const env = loadEnv();
const app = buildApp();

const server = serve(
  { fetch: app.fetch, port: env.API_PORT, hostname: "0.0.0.0" },
  (info) => {
    logger.info({ port: info.port, env: env.NODE_ENV }, "API listening");
  },
);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    logger.info("http server closed");
  });
  await flushSentry();
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
