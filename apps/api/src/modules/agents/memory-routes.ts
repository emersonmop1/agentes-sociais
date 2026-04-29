import { Hono } from "hono";
import { z } from "zod";
import { getAgent } from "../../agents/registry.js";
import {
  deleteMemory,
  insertMemory,
  listMemories,
  toggleActive,
  updateMemory,
  type MemoryRow,
} from "../../db/repositories/memories.js";
import { extractKeywords } from "../../core/stopwords.js";
import { one } from "../../db/client.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const memoryRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

const memoryTypeSchema = z.enum(["correction", "knowledge", "pattern", "preference"]);

// ─── GET /api/agents/:slug/memories ─────────────────────────────────────────
const listSchema = z.object({
  type: memoryTypeSchema.optional(),
  category: z.string().max(100).optional(),
  active: z.enum(["true", "false"]).optional(),
});

memoryRoutes.get("/:slug/memories", async (c) => {
  const slug = c.req.param("slug");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  const q = listSchema.parse({
    type: c.req.query("type"),
    category: c.req.query("category"),
    active: c.req.query("active"),
  });
  const rows = await listMemories(undefined, {
    companyId: c.var.company.companyId,
    agentSlug: slug,
    type: q.type,
    category: q.category,
    active: q.active === undefined ? true : q.active === "true",
  });
  return c.json({ memories: rows.map(toApi) });
});

// ─── POST /api/agents/:slug/memories (manual create) ────────────────────────
const createSchema = z.object({
  content: z.string().min(1).max(2000),
  category: z.string().max(100).optional(),
  memory_type: memoryTypeSchema.default("knowledge"),
  priority: z.number().int().min(1).max(10).default(5),
  context: z.string().max(2000).optional(),
});

memoryRoutes.post("/:slug/memories", async (c) => {
  const slug = c.req.param("slug");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  const body = createSchema.parse(await c.req.json());
  const keywords = extractKeywords(body.content, 10);
  const row = await insertMemory(undefined, {
    companyId: c.var.company.companyId,
    agentSlug: slug,
    content: body.content,
    category: body.category,
    memoryType: body.memory_type,
    source: "manual",
    priority: body.priority,
    searchText: keywords.join(" "),
    context: body.context ?? null,
  });
  return c.json({ memory: toApi(row) }, 201);
});

// ─── PATCH /api/agents/:slug/memories/:id ───────────────────────────────────
const patchSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

memoryRoutes.patch("/:slug/memories/:id", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  // Ensure ownership
  const existing = await one<MemoryRow>(
    undefined,
    `SELECT * FROM public.agent_memories
      WHERE id = $1 AND company_id = $2 AND agent_slug = $3`,
    [id, c.var.company.companyId, slug],
  );
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = patchSchema.parse(await c.req.json());
  const searchText = body.content
    ? extractKeywords(body.content, 10).join(" ")
    : undefined;
  const updated = await updateMemory(undefined, {
    id,
    content: body.content,
    priority: body.priority,
    searchText,
  });
  return c.json({ memory: toApi(updated) });
});

// ─── POST /api/agents/:slug/memories/:id/toggle ─────────────────────────────
memoryRoutes.post("/:slug/memories/:id/toggle", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  const existing = await one<MemoryRow>(
    undefined,
    `SELECT * FROM public.agent_memories
      WHERE id = $1 AND company_id = $2 AND agent_slug = $3`,
    [id, c.var.company.companyId, slug],
  );
  if (!existing) return c.json({ error: "not_found" }, 404);
  const updated = await toggleActive(undefined, id);
  return c.json({ memory: toApi(updated) });
});

// ─── DELETE /api/agents/:slug/memories/:id ──────────────────────────────────
memoryRoutes.delete("/:slug/memories/:id", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  const existing = await one<MemoryRow>(
    undefined,
    `SELECT * FROM public.agent_memories
      WHERE id = $1 AND company_id = $2 AND agent_slug = $3`,
    [id, c.var.company.companyId, slug],
  );
  if (!existing) return c.json({ error: "not_found" }, 404);
  await deleteMemory(undefined, id);
  return c.json({ ok: true });
});

function toApi(m: MemoryRow) {
  return {
    id: m.id,
    content: m.content,
    context: m.context,
    category: m.category,
    memory_type: m.memory_type,
    source: m.source,
    priority: m.priority,
    times_used: m.times_used,
    last_used_at: m.last_used_at,
    is_active: m.is_active,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}
