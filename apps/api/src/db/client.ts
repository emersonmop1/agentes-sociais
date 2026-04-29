import pg from "pg";
import { loadEnv } from "../env.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;
  const env = loadEnv();
  _pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  _pool.on("error", (err) => {
    logger.error({ err }, "pg pool unexpected error on idle client");
  });
  return _pool;
}

export type SqlValue = string | number | boolean | null | Date | object | unknown[];

/**
 * Either a Pool or a Client (used inside transactions).
 * All helpers accept either, so a function written for outside-transaction
 * use can be reused inside one by passing the transaction client.
 */
export type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

/** Run a query, return all rows typed as T. */
export async function many<T = Record<string, unknown>>(
  q: Queryable | undefined,
  text: string,
  values: SqlValue[] = [],
): Promise<T[]> {
  const client = q ?? getPool();
  const result = await client.query(text, values);
  return result.rows as T[];
}

/** Run a query, return the first row typed as T or null. */
export async function one<T = Record<string, unknown>>(
  q: Queryable | undefined,
  text: string,
  values: SqlValue[] = [],
): Promise<T | null> {
  const rows = await many<T>(q, text, values);
  return rows[0] ?? null;
}

/** Run a query, return the first row or throw if none. Use when row is required. */
export async function oneOrThrow<T = Record<string, unknown>>(
  q: Queryable | undefined,
  text: string,
  values: SqlValue[] = [],
): Promise<T> {
  const row = await one<T>(q, text, values);
  if (!row) {
    throw new Error(`Expected exactly one row, got 0 for query: ${text}`);
  }
  return row;
}

/** Run a query, ignore rows. Returns rowCount. */
export async function exec(
  q: Queryable | undefined,
  text: string,
  values: SqlValue[] = [],
): Promise<number> {
  const client = q ?? getPool();
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}

/**
 * Run a function inside a transaction. Auto-commits on success, rolls back on
 * any thrown error. The callback receives a PoolClient that must be passed to
 * one/many/exec helpers via the first argument.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, "tx rollback failed");
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Health check: verifies the pool can acquire a connection and run SELECT 1. */
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch (err) {
    logger.warn({ err }, "db ping failed");
    return false;
  }
}

/** Graceful shutdown — close the pool. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
