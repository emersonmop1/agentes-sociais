/**
 * Reels routes — `/api/reels/*`.
 *
 * The chat endpoint is the main interaction point: posting a message creates
 * (or advances) a reels_scripts row. The state machine determines which
 * stage's prompt is used based on the row's current status.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pickHook, runReelsTurn } from "../../agents/reels-creator/handler.js";
import { applyTransition } from "../../core/reels-state-machine.js";
import {
  appendMessage,
  listMessages,
} from "../../db/repositories/chat.js";
import { recordExecution } from "../../db/repositories/executions.js";
import {
  createReel,
  deleteReel,
  getReelById,
  listReels,
  updateBroll,
  updateCaption as updateCaptionRepo,
  type ReelsScriptRow,
} from "../../db/repositories/reels-scripts.js";
import {
  createSession,
  getSession,
} from "../../db/repositories/sessions.js";
import { buildReelsPdf } from "../../services/reels-pdf.js";
import { consumeQuota } from "../../services/quota.js";
import { logger } from "../../lib/logger.js";
import type { LLMMessage } from "../../lib/llm/index.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const reelsRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── POST /api/reels/chat ── chat with ReelsCreator ─────────────────────────
const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  /** Existing reel session (creates new if absent + first message). */
  reel_id: z.string().uuid().optional(),
  /** Free-text instructions that augment the system prompt. */
  user_instructions: z.string().max(2000).optional(),
});

reelsRoutes.post("/chat", async (c) => {
  const startedAt = Date.now();
  const body = chatBodySchema.parse(await c.req.json());
  const companyId = c.var.company.companyId;
  const userId = c.var.auth.userId;

  // Resolve reel + chat session (1:1 — each reel has its own chat session)
  let reel: ReelsScriptRow;
  if (body.reel_id) {
    const found = await getReelById(undefined, body.reel_id, companyId);
    if (!found) return c.json({ error: "reel_not_found" }, 404);
    reel = found;
  } else {
    // New reel → consume "reels" quota first (atomic, 429 if exhausted)
    const q = await consumeQuota(undefined, companyId, "reels");
    if (!q.ok) return c.json(q.json, 429);

    // Lazy create — title gets refined by the agent in HOOKS output
    const fresh = await createReel(undefined, {
      companyId,
      createdBy: userId,
      title: body.message.slice(0, 100),
    });
    reel = fresh;
  }

  let sessionId = reel.chat_session_id;
  if (!sessionId) {
    const ses = await createSession(undefined, {
      companyId,
      userId,
      agentSlug: "reels-creator",
      sessionType: "reels",
      title: reel.title.slice(0, 80),
    });
    sessionId = ses.id;
    await import("../../db/client.js").then(({ exec }) =>
      exec(undefined, `UPDATE public.reels_scripts SET chat_session_id = $2 WHERE id = $1`, [
        reel.id,
        sessionId,
      ]),
    );
  } else {
    const ses = await getSession(undefined, sessionId, companyId);
    if (!ses) return c.json({ error: "session_not_found" }, 404);
  }

  // Append user msg + load history
  await appendMessage(undefined, {
    sessionId,
    role: "user",
    content: body.message,
  });
  const history = await listMessages(undefined, sessionId, 40);
  const llmHistory: LLMMessage[] = history.map((m) => ({
    role: m.role === "system" ? "user" : m.role,
    content: m.content,
  }));

  const result = await runReelsTurn({
    companyId,
    reel,
    history: llmHistory,
    userInstructions: body.user_instructions,
  });

  const assistantMsgId = await appendMessage(undefined, {
    sessionId,
    role: "assistant",
    content: result.assistantContent,
    tokensUsed: result.tokens,
    providerModel: result.model,
    metadata: result.parsed ? { parsed_stage: result.parsed } : undefined,
  });

  void recordExecution(undefined, {
    companyId,
    agentSlug: "reels-creator",
    sessionId,
    trigger: "chat",
    provider: "gemini",
    model: result.model,
    tokensInput: result.tokens.input,
    tokensOutput: result.tokens.output,
    latencyMs: Date.now() - startedAt,
    memoriesRecalled: result.memoriesUsed,
    metadata: { parsed_stage: result.parsed ?? null, status_after: result.reel.status },
  });

  return c.json({
    session_id: sessionId,
    assistant: {
      id: assistantMsgId,
      role: "assistant" as const,
      content: result.conversationalText,
      raw_content: result.assistantContent,
      model: result.model,
      tokens: result.tokens,
    },
    reel: toReelDetailApi(result.reel),
    parsed_stage: result.parsed,
    memories_used: result.memoriesUsed,
  });
});

// ─── POST /api/reels/scripts/:id/pick-hook ─────────────────────────────────
const pickHookSchema = z
  .object({
    hook_index: z.number().int().nonnegative().optional(),
    custom_hook: z.string().min(1).max(500).optional(),
  })
  .refine(
    (v) => v.hook_index !== undefined || (v.custom_hook && v.custom_hook.length > 0),
    { message: "hook_index or custom_hook required" },
  );

reelsRoutes.post("/scripts/:id/pick-hook", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  if (reel.status !== "hooks_review") {
    return c.json({ error: "invalid_state", current: reel.status }, 409);
  }
  const body = pickHookSchema.parse(await c.req.json());
  try {
    const updated = await pickHook({
      reel,
      companyId: c.var.company.companyId,
      hookIndex: body.hook_index,
      customHook: body.custom_hook,
    });
    return c.json({ reel: toReelDetailApi(updated) });
  } catch (err) {
    return c.json({ error: "pick_failed", message: (err as Error).message }, 400);
  }
});

// ─── POST /api/reels/scripts/:id/approve ── advance current review stage ────
reelsRoutes.post("/scripts/:id/approve", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);

  const event = (() => {
    switch (reel.status) {
      case "script_review": return "approve_script" as const;
      case "caption_review": return "approve_caption" as const;
      case "broll_review": return "approve_broll" as const;
      default: return null;
    }
  })();
  if (!event) {
    return c.json({ error: "invalid_state", current: reel.status }, 409);
  }
  try {
    const t = await applyTransition({
      reelId: reel.id,
      companyId: reel.company_id,
      current: reel.status,
      event,
    });
    return c.json({ reel: toReelDetailApi(t.row), description: t.description });
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }
});

// ─── POST /api/reels/scripts/:id/reject ─────────────────────────────────────
const rejectBodySchema = z.object({
  feedback: z.string().min(1).max(2000),
});

reelsRoutes.post("/scripts/:id/reject", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  const body = rejectBodySchema.parse(await c.req.json());
  try {
    const t = await applyTransition({
      reelId: reel.id,
      companyId: reel.company_id,
      current: reel.status,
      event: "reject",
      rejectionFeedback: body.feedback,
    });
    return c.json({ reel: toReelDetailApi(t.row) });
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }
});

// ─── PATCH /api/reels/scripts/:id ── manual edit ────────────────────────────
const patchSchema = z.object({
  caption: z.string().max(4000).optional(),
  cta: z.string().max(500).optional(),
  hashtags: z.array(z.string()).max(50).optional(),
  broll_suggestions: z.array(z.string()).max(20).optional(),
  voice_over_script: z.string().max(5000).optional(),
  edit_notes: z.string().max(2000).optional(),
});

reelsRoutes.patch("/scripts/:id", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  const body = patchSchema.parse(await c.req.json());

  let row = reel;
  if (body.caption !== undefined || body.cta !== undefined || body.hashtags !== undefined) {
    row = await updateCaptionRepo(undefined, {
      id: reel.id,
      companyId: reel.company_id,
      caption: body.caption ?? reel.caption ?? "",
      cta: body.cta ?? reel.cta,
      hashtags: body.hashtags ?? reel.hashtags,
    });
  }
  if (
    body.broll_suggestions !== undefined ||
    body.voice_over_script !== undefined ||
    body.edit_notes !== undefined
  ) {
    row = await updateBroll(undefined, {
      id: reel.id,
      companyId: reel.company_id,
      broll_suggestions: body.broll_suggestions ?? reel.broll_suggestions,
      voice_over_script: body.voice_over_script ?? reel.voice_over_script,
      edit_notes: body.edit_notes ?? reel.edit_notes,
    });
  }
  return c.json({ reel: toReelDetailApi(row) });
});

// ─── GET /api/reels/scripts ────────────────────────────────────────────────
reelsRoutes.get("/scripts", async (c) => {
  const rows = await listReels(undefined, { companyId: c.var.company.companyId });
  return c.json({
    reels: rows.map(toReelSummaryApi),
  });
});

// ─── GET /api/reels/scripts/:id ────────────────────────────────────────────
reelsRoutes.get("/scripts/:id", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  return c.json({ reel: toReelDetailApi(reel) });
});

// ─── DELETE /api/reels/scripts/:id ─────────────────────────────────────────
reelsRoutes.delete("/scripts/:id", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  await deleteReel(undefined, reel.id, reel.company_id);
  return c.json({ ok: true });
});

// ─── GET /api/reels/scripts/:id/export.pdf ─────────────────────────────────
reelsRoutes.get("/scripts/:id/export.pdf", async (c) => {
  const reel = await getReelById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!reel) return c.json({ error: "not_found" }, 404);
  let pdf;
  try {
    pdf = await buildReelsPdf(reel);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "reels pdf failed");
    return c.json({ error: "pdf_failed", message: (err as Error).message }, 500);
  }
  const filename = `reel-${reel.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
  // Convert Buffer → Uint8Array slice so it satisfies Response's BodyInit type
  const view = new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  return new Response(view, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function toReelSummaryApi(r: ReelsScriptRow) {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    target_duration: r.target_duration,
    chosen_hook: r.chosen_hook,
    has_beats: r.beats.length > 0,
    has_caption: Boolean(r.caption),
    has_broll: r.broll_suggestions.length > 0 || Boolean(r.voice_over_script),
    revision_count: r.revision_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toReelDetailApi(r: ReelsScriptRow) {
  return {
    ...toReelSummaryApi(r),
    theme: r.theme,
    hook_options: r.hook_options,
    beats: r.beats,
    caption: r.caption,
    cta: r.cta,
    hashtags: r.hashtags,
    broll_suggestions: r.broll_suggestions,
    voice_over_script: r.voice_over_script,
    edit_notes: r.edit_notes,
    rejection_feedback: r.rejection_feedback,
    chat_session_id: r.chat_session_id,
  };
}
