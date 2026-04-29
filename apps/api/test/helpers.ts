/**
 * Test helpers — boot a Hono app instance, create real Supabase admin
 * users + JWTs, clean up after.
 *
 * The post-signup Postgres trigger from migration 0001 creates
 * profiles + companies + company_members for us, so the only thing the
 * test needs to do is `admin.createUser`. After the test, we delete the
 * user, which cascades and removes everything.
 *
 * createUser bypasses Supabase's email validation (so @example.com works
 * for tests) — public auth.signUp would reject those.
 */

import type { Hono } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

let _app: Hono | null = null;
let _admin: SupabaseClient | null = null;

export function getApp(): Hono {
  if (!_app) _app = buildApp();
  return _app;
}

function admin(): SupabaseClient {
  if (_admin) return _admin;
  const env = loadEnv();
  _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  jwt: string;
  /** Company auto-created by the post-signup trigger. */
  companyId: string;
  cleanup: () => Promise<void>;
}

export async function createTestUser(): Promise<TestUser> {
  const env = loadEnv();
  const id = Math.random().toString(36).slice(2, 10);
  const email = `vitest-${id}@example.com`;
  const password = `Vitest!${id}-${Date.now()}`;

  // 1. Admin-create — bypasses email validation domain block
  const created = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw new Error(`admin.createUser: ${created.error.message}`);
  const userId = created.data.user!.id;

  // 2. Sign in as that user via the public flow to get a JWT
  const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signed = await userClient.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`signInWithPassword: ${signed.error.message}`);
  const jwt = signed.data.session!.access_token;

  // 3. Wait briefly for the post-signup trigger to fire then resolve company.
  // The trigger runs synchronously inside the auth.users insert, but reading
  // through the pooler can lag a tick. Poll up to 2s.
  const pgClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let companyId = "";
  for (let i = 0; i < 10; i += 1) {
    const r = await pgClient
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (r.data?.company_id) {
      companyId = r.data.company_id;
      break;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!companyId) {
    throw new Error("post-signup trigger did not create company within 2s");
  }

  return {
    userId,
    email,
    password,
    jwt,
    companyId,
    cleanup: async () => {
      // Cascading FKs delete profile + company + members
      await admin().auth.admin.deleteUser(userId);
    },
  };
}

export async function authedFetch(
  user: TestUser,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${user.jwt}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return getApp().fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
    }),
  );
}

export async function publicFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return getApp().fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
    }),
  );
}
