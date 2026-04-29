/**
 * Companies routes — `/api/companies/*`.
 *
 * Currently exposes `/me`, the active-company snapshot the frontend uses for
 * the sidebar quota badges and the onboarding state guard. We don't need the
 * full row — just plan, quotas, reset window and onboarding flag.
 */

import { Hono } from "hono";
import { getCompanyById } from "../../db/repositories/companies.js";
import { logger } from "../../lib/logger.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const companiesRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── GET /api/companies/me ─────────────────────────────────────────────────
companiesRoutes.get("/me", async (c) => {
  const companyId = c.var.company.companyId;
  const row = await getCompanyById(undefined, companyId);
  if (!row) {
    logger.warn({ companyId }, "companies/me: company not found");
    return c.json({ error: "company_not_found" }, 404);
  }
  return c.json({
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    onboarding_completed: row.onboarding_completed,
    quotas: {
      posts_remaining: row.posts_quota_remaining,
      reels_remaining: row.reels_quota_remaining,
      youtube_remaining: row.youtube_projects_quota_remaining,
      chat_remaining: row.chat_messages_quota_remaining,
      resets_at: row.quota_resets_at,
    },
  });
});
