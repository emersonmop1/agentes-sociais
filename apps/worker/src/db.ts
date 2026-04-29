import pg from "pg";
import { loadEnv } from "./env.js";
import { logger } from "./lib/logger.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;
  const env = loadEnv();
  _pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 6,
    idleTimeoutMillis: 30_000,
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  _pool.on("error", (err) => logger.error({ err }, "pg pool error"));
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
