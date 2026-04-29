import { Hono } from "hono";
import { many } from "../../db/client.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";
import { agentChatRoutes } from "./chat-routes.js";
import { memoryRoutes } from "./memory-routes.js";

export const agentsRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

interface CatalogRow {
  slug: string;
  name: string;
  description: string;
  avatar_emoji: string;
  gradient_from: string;
  gradient_to: string;
  category: "onboarding" | "social" | "copy" | "video";
  is_visible: boolean;
  sort_order: number;
}

// Compose: chat + memory CRUD live under /api/agents/...
agentsRoutes.route("/", agentChatRoutes);
agentsRoutes.route("/", memoryRoutes);

// ─── GET /api/agents — list visible agents for the dashboard ────────────────
agentsRoutes.get("/", async (c) => {
  const rows = await many<CatalogRow>(
    undefined,
    `SELECT slug, name, description, avatar_emoji, gradient_from, gradient_to, category, is_visible, sort_order
       FROM public.agent_catalog
      WHERE is_visible = true
      ORDER BY sort_order ASC`,
  );
  return c.json({
    agents: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      avatar_emoji: r.avatar_emoji,
      gradient: [r.gradient_from, r.gradient_to] as const,
      category: r.category,
    })),
  });
});
