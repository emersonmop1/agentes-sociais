import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { getAgent } from "../../agents/registry.js";
import { runChat, runChatStream } from "../../core/agent-runner.js";
import { recordExecution } from "../../db/repositories/executions.js";
import {
  extractFeedbackMemory,
  store as storeMemory,
} from "../../core/memory-manager.js";
import {
  appendMessage,
  listMessages,
  type ChatMessageRow,
} from "../../db/repositories/chat.js";
import {
  archiveSession,
  deleteSession as deleteSessionDb,
  getSession,
  listSessions,
  updateSessionTitle,
} from "../../db/repositories/sessions.js";
import { logger } from "../../lib/logger.js";
import { consumeQuota } from "../../services/quota.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const agentChatRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── POST /api/agents/:slug/chat ── sync chat ───────────────────────────────
const chatBodySchema = z.object({
  message: z.string().min(1).max(8000),
  session_id: z.string().uuid().optional(),
});

agentChatRoutes.post("/:slug/chat", async (c) => {
  const slug = c.req.param("slug");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);

  const body = chatBodySchema.parse(await c.req.json());

  // Per-user-message quota — applies to all agents on this generic chat route.
  const q = await consumeQuota(undefined, c.var.company.companyId, "chat");
  if (!q.ok) return c.json(q.json, 429);

  const result = await runChat({
    companyId: c.var.company.companyId,
    userId: c.var.auth.userId,
    agentSlug: slug,
    sessionId: body.session_id,
    userMessage: body.message,
  });
  return c.json({
    session_id: result.sessionId,
    user_message_id: result.userMessageId,
    assistant: {
      id: result.assistantMessageId,
      role: "assistant" as const,
      content: result.assistantContent,
      model: result.model,
      tokens: result.tokens,
    },
    memories_used: result.memoriesUsed,
  });
});

// ─── POST /api/agents/:slug/chat/stream ── SSE streaming ────────────────────
agentChatRoutes.post("/:slug/chat/stream", async (c) => {
  const slug = c.req.param("slug");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);

  const body = chatBodySchema.parse(await c.req.json());

  const q = await consumeQuota(undefined, c.var.company.companyId, "chat");
  if (!q.ok) return c.json(q.json, 429);

  return streamSSE(c, async (stream) => {
    let heartbeatInterval: NodeJS.Timeout | undefined;
    try {
      // 15s heartbeat — Cloudflare/Fly drop idle SSE after ~100s.
      heartbeatInterval = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => undefined);
      }, 15_000);
      heartbeatInterval.unref?.();

      const generator = runChatStream({
        companyId: c.var.company.companyId,
        userId: c.var.auth.userId,
        agentSlug: slug,
        sessionId: body.session_id,
        userMessage: body.message,
      });

      for await (const chunk of generator) {
        await stream.writeSSE({
          event: chunk.type,
          data: JSON.stringify(chunk),
        });
        if (chunk.type === "done" || chunk.type === "error") break;
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "stream chat error");
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message: (err as Error).message }),
      });
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    }
  });
});

// ─── POST /api/agents/:slug/messages/:msgId/feedback ── 👍 / 👎 ─────────────
const feedbackBodySchema = z.object({
  is_positive: z.boolean(),
  comment: z.string().max(500).optional(),
  section_content: z.string().max(2000).optional(),
});

agentChatRoutes.post("/:slug/messages/:msgId/feedback", async (c) => {
  const slug = c.req.param("slug");
  const msgId = c.req.param("msgId");
  const agent = getAgent(slug);
  if (!agent) return c.json({ error: "unknown_agent", slug }, 404);

  const body = feedbackBodySchema.parse(await c.req.json());

  // Find the assistant message + its session, verify access
  const sessionMsg = await import("../../db/client.js").then(({ one }) =>
    one<ChatMessageRow & { session_company: string }>(
      undefined,
      `SELECT m.*, s.company_id AS session_company
         FROM public.chat_messages m
         JOIN public.chat_sessions s ON s.id = m.session_id
        WHERE m.id = $1 AND s.company_id = $2 AND m.role = 'assistant'
        LIMIT 1`,
      [msgId, c.var.company.companyId],
    ),
  );
  if (!sessionMsg) return c.json({ error: "message_not_found" }, 404);

  // Find the prior user message in the same session for context
  const allMsgs = await listMessages(undefined, sessionMsg.session_id, 200);
  const idx = allMsgs.findIndex((m) => m.id === msgId);
  const priorUserMsg =
    idx >= 0 ? [...allMsgs.slice(0, idx)].reverse().find((m) => m.role === "user") : null;
  if (!priorUserMsg) {
    return c.json({ error: "no_user_context" }, 400);
  }

  const extracted = await extractFeedbackMemory({
    assistantMessage: sessionMsg.content,
    userPriorMessage: priorUserMsg.content,
    isPositive: body.is_positive,
    comment: body.comment,
    sectionContent: body.section_content,
  });

  let memoryId: string | null = null;
  if (extracted) {
    const memory = await storeMemory({
      companyId: c.var.company.companyId,
      agentSlug: agent.slug,
      sessionId: sessionMsg.session_id,
      content: extracted.memory_content,
      memoryType: extracted.memory_type,
      source: "user_feedback",
      category: extracted.category,
      priority: extracted.priority,
      searchKeywords: extracted.search_keywords,
    });
    memoryId = memory.id;
  } else {
    // Fallback: store the literal feedback text
    const literal = body.is_positive
      ? `Manter este padrão: ${body.comment ?? "(sem comentário)"}`
      : `Evitar: ${body.comment ?? "(sem comentário)"}`;
    const memory = await storeMemory({
      companyId: c.var.company.companyId,
      agentSlug: agent.slug,
      sessionId: sessionMsg.session_id,
      content: literal,
      memoryType: body.is_positive ? "pattern" : "correction",
      source: "user_feedback",
      priority: body.is_positive ? 6 : 8,
      searchKeywords: priorUserMsg.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5),
    });
    memoryId = memory.id;
  }

  void recordExecution(undefined, {
    companyId: c.var.company.companyId,
    agentSlug: agent.slug,
    sessionId: sessionMsg.session_id,
    trigger: "feedback",
    memoriesStored: memoryId ? 1 : 0,
    metadata: { is_positive: body.is_positive },
  });

  return c.json({ memory_id: memoryId, is_positive: body.is_positive });
});

// ─── GET /api/agents/:slug/sessions ─────────────────────────────────────────
agentChatRoutes.get("/:slug/sessions", async (c) => {
  const slug = c.req.param("slug");
  if (!getAgent(slug)) return c.json({ error: "unknown_agent", slug }, 404);
  const rows = await listSessions(undefined, {
    companyId: c.var.company.companyId,
    agentSlug: slug,
  });
  return c.json({
    sessions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      session_type: r.session_type,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

// ─── GET /api/sessions/:id (with messages) ──────────────────────────────────
agentChatRoutes.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = await getSession(undefined, id, c.var.company.companyId);
  if (!session) return c.json({ error: "not_found" }, 404);
  const messages = await listMessages(undefined, id, 500);
  return c.json({
    session: {
      id: session.id,
      agent_slug: session.agent_slug,
      title: session.title,
      session_type: session.session_type,
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      tokens_used: m.tokens_used,
      provider_model: m.provider_model,
      metadata: m.metadata,
    })),
  });
});

// ─── DELETE /api/sessions/:id ───────────────────────────────────────────────
agentChatRoutes.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  await deleteSessionDb(undefined, id, c.var.company.companyId);
  return c.json({ ok: true });
});

// ─── PATCH /api/sessions/:id (rename) ───────────────────────────────────────
const sessionPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  archive: z.boolean().optional(),
});
agentChatRoutes.patch("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = sessionPatchSchema.parse(await c.req.json());
  const session = await getSession(undefined, id, c.var.company.companyId);
  if (!session) return c.json({ error: "not_found" }, 404);
  if (body.title) await updateSessionTitle(undefined, id, body.title);
  if (body.archive) await archiveSession(undefined, id, c.var.company.companyId);
  return c.json({ ok: true });
});
