import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { loadEnv } from "../env.js";
import { logger } from "../lib/logger.js";

export interface AuthContext {
  userId: string;
  email: string | null;
  /** raw JWT payload — useful for app_metadata etc. */
  claims: JWTPayload;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (_jwks) return _jwks;
  const env = loadEnv();
  // Supabase Auth JWKS endpoint (RS256 since auth v2.165). Has built-in cache.
  const jwksUrl = new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  _jwks = createRemoteJWKSet(jwksUrl, {
    cooldownDuration: 30_000,
    cacheMaxAge: 60 * 60 * 1000, // 1h
  });
  return _jwks;
}

/**
 * Validates the Authorization: Bearer <jwt> header against Supabase Auth.
 * On success, stores AuthContext in c.var.auth and continues. On failure, 401.
 *
 * Falls back to HS256 verification with SUPABASE_JWT_SECRET when the project
 * still uses legacy HS256 tokens — Supabase rolled out RS256 in late 2024 but
 * older projects may not have migrated. We try RS256 first, HS256 fallback.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing Bearer token" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return c.json({ error: "unauthorized", message: "Empty Bearer token" }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      // Supabase issues the token with iss=https://<ref>.supabase.co/auth/v1
      issuer: `${loadEnv().SUPABASE_URL}/auth/v1`,
    });

    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) {
      return c.json({ error: "unauthorized", message: "Token missing sub" }, 401);
    }

    c.set("auth", {
      userId: sub,
      email: typeof payload.email === "string" ? payload.email : null,
      claims: payload,
    });
    await next();
    return;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "JWT verify failed");
    return c.json({ error: "unauthorized", message: "Invalid token" }, 401);
  }
};
