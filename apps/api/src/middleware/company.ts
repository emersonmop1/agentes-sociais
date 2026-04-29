import type { MiddlewareHandler } from "hono";
import { one } from "../db/client.js";

export interface CompanyContext {
  companyId: string;
  role: "owner" | "admin" | "member";
}

declare module "hono" {
  interface ContextVariableMap {
    company: CompanyContext;
  }
}

interface CompanyRow {
  company_id: string;
  role: "owner" | "admin" | "member";
}

/**
 * Resolves the active company for the authenticated user.
 *
 * Resolution order:
 *   1. X-Company-Id header (must be a company the user is a member of)
 *   2. profiles.default_company_id
 *   3. First company_members row for this user
 *
 * Returns 403 if the user has no companies (which shouldn't happen — the
 * post-signup trigger always creates one). Returns 403 if X-Company-Id
 * points to a company the user isn't a member of.
 *
 * MUST run AFTER requireAuth.
 */
export const resolveCompany: MiddlewareHandler = async (c, next) => {
  const auth = c.var.auth;
  if (!auth) {
    return c.json({ error: "internal", message: "resolveCompany requires requireAuth" }, 500);
  }

  const headerCompanyId = c.req.header("x-company-id") ?? c.req.header("X-Company-Id");

  let row: CompanyRow | null = null;

  if (headerCompanyId) {
    row = await one<CompanyRow>(
      undefined,
      `SELECT company_id, role
         FROM public.company_members
        WHERE user_id = $1 AND company_id = $2
        LIMIT 1`,
      [auth.userId, headerCompanyId],
    );
    if (!row) {
      return c.json(
        { error: "forbidden", message: "You are not a member of this company" },
        403,
      );
    }
  } else {
    row = await one<CompanyRow>(
      undefined,
      `SELECT cm.company_id, cm.role
         FROM public.company_members cm
         LEFT JOIN public.profiles p ON p.id = cm.user_id
        WHERE cm.user_id = $1
        ORDER BY (cm.company_id = p.default_company_id) DESC, cm.joined_at ASC
        LIMIT 1`,
      [auth.userId],
    );
    if (!row) {
      return c.json(
        { error: "no_company", message: "User has no company. Signup trigger may have failed." },
        403,
      );
    }
  }

  c.set("company", { companyId: row.company_id, role: row.role });
  await next();
};

/**
 * Companion guard for endpoints that mutate company-level resources (invites,
 * brand settings, integrations). Must run AFTER resolveCompany. Returns 403
 * for non-owners. v2: extend to admins for selective routes.
 */
export const requireOwner: MiddlewareHandler = async (c, next) => {
  const company = c.var.company;
  if (!company || company.role !== "owner") {
    return c.json(
      {
        error: "forbidden",
        message: "Owner role required for this action",
        current_role: company?.role ?? null,
      },
      403,
    );
  }
  await next();
};
