/**
 * ReelsCreator handler — orchestrates the 4-stage Reels pipeline.
 *
 * Each chat turn picks the active stage based on the reel's status, builds
 * the right system prompt, calls Gemini Pro, parses the delimited block, and
 * (when a parse succeeds) persists the new fields and applies the transition.
 */

import { z } from "zod";
import { applyTransition, nextStatus } from "../../core/reels-state-machine.js";
import { recall, markUsed } from "../../core/memory-manager.js";
import { buildAgentPrompt } from "../../core/prompt-builder.js";
import { tx } from "../../db/client.js";
import {
  type ReelsBeat,
  type ReelsHookOption,
  type ReelsScriptRow,
  updateBeats,
  updateBroll,
  updateCaption,
  updateChosenHook,
  updateHookOptions,
} from "../../db/repositories/reels-scripts.js";
import { getDefaultProvider, type LLMMessage } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import { SOUL } from "./soul.js";
import { renderSystemPrompt, type ReelsStage } from "./system-prompt.js";

// ─── Output parsers ──────────────────────────────────────────────────────

const hooksOutputSchema = z.object({
  title: z.string().min(1).max(200),
  theme: z.string().max(500).optional(),
  target_duration: z.number().int().positive().max(180).default(30),
  hooks: z
    .array(
      z.object({
        angle: z.string(),
        hook: z.string(),
        why: z.string(),
      }),
    )
    .min(2)
    .max(8),
});
type HooksOutput = z.infer<typeof hooksOutputSchema>;

const scriptOutputSchema = z.object({
  chosen_hook_confirm: z.string().optional(),
  beats: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        start_seconds: z.number().nonnegative(),
        end_seconds: z.number().positive(),
        visual: z.string(),
        on_camera_speech: z.string().default(""),
        on_screen_text: z.string().default(""),
        broll_hint: z.string().optional().default(""),
      }),
    )
    .min(2)
    .max(20),
});
type ScriptOutput = z.infer<typeof scriptOutputSchema>;

const captionOutputSchema = z.object({
  caption: z.string().min(10).max(2000),
  cta: z.string().max(500).optional().default(""),
  hashtags: z.array(z.string()).max(50),
});
type CaptionOutput = z.infer<typeof captionOutputSchema>;

const brollOutputSchema = z.object({
  broll_suggestions: z.array(z.string()).max(20),
  voice_over_script: z.string().max(5000),
  edit_notes: z.string().max(2000),
});
type BrollOutput = z.infer<typeof brollOutputSchema>;

function extractBlock(text: string, marker: string): { json: string; rest: string } | null {
  const re = new RegExp(`---${marker}---\\s*([\\s\\S]*?)\\s*---${marker}---`);
  const m = text.match(re);
  if (!m) return null;
  let inner = m[1] ?? "";
  inner = inner.replace(/```(?:json)?/g, "").trim();
  return { json: inner, rest: text.replace(re, "").trim() };
}

function tryParse<S extends z.ZodTypeAny>(
  text: string,
  marker: string,
  schema: S,
): { data: z.output<S> | null; conversationalText: string } {
  const block = extractBlock(text, marker);
  if (!block) return { data: null, conversationalText: text };
  try {
    const parsed = schema.parse(JSON.parse(block.json));
    return { data: parsed, conversationalText: block.rest };
  } catch (err) {
    logger.warn(
      { marker, err: (err as Error).message, sample: block.json.slice(0, 200) },
      "reels-creator: failed to parse block",
    );
    return { data: null, conversationalText: text };
  }
}

// ─── Stage decider ───────────────────────────────────────────────────────

export function stageFor(status: ReelsScriptRow["status"]): ReelsStage {
  switch (status) {
    case "draft":
    case "hooks_review":
      return "hooks";
    case "hook_picked":
    case "script_review":
      return "script";
    case "script_approved":
    case "caption_review":
      return "caption";
    case "caption_approved":
    case "broll_review":
    case "ready":
      return "broll";
    case "rejected":
      return "hooks";
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────

export interface RunReelsTurnArgs {
  companyId: string;
  reel: ReelsScriptRow;
  history: LLMMessage[];
  userInstructions?: string;
}

export interface RunReelsTurnResult {
  assistantContent: string;
  conversationalText: string;
  /** The reel row after any parse-driven update (or unchanged if no parse). */
  reel: ReelsScriptRow;
  parsed: "hooks" | "script" | "caption" | "broll" | null;
  tokens: { input?: number; output?: number };
  model: string;
  memoriesUsed: number;
}

export async function runReelsTurn(args: RunReelsTurnArgs): Promise<RunReelsTurnResult> {
  const stage = stageFor(args.reel.status);

  const lastUser =
    [...args.history].reverse().find((m) => m.role === "user")?.content ?? "";
  const { memories } = await recall({
    companyId: args.companyId,
    agentSlug: "reels-creator",
    query: lastUser,
  });

  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: SOUL,
    systemPrompt: renderSystemPrompt({
      stage,
      userInstructions: args.userInstructions,
      state: {
        title: args.reel.title,
        theme: args.reel.theme ?? undefined,
        target_duration: args.reel.target_duration,
        chosen_hook: args.reel.chosen_hook,
        caption: args.reel.caption,
        cta: args.reel.cta,
      },
    }),
    memories,
  });

  const r = await getDefaultProvider().chat(args.history, {
    system: systemPrompt,
    tier: "pro",
    temperature: 0.85,
    maxOutputTokens: 4096,
  });
  if (memories.length > 0) {
    void markUsed(memories.map((m) => m.id)).catch(() => undefined);
  }

  // Parse whichever block matches the active stage
  let updatedReel = args.reel;
  let parsed: RunReelsTurnResult["parsed"] = null;
  let conversationalText = r.content;

  if (stage === "hooks") {
    const out = tryParse(r.content, "HOOKS", hooksOutputSchema);
    if (out.data) {
      updatedReel = await persistHooks({
        reel: args.reel,
        companyId: args.companyId,
        out: out.data,
      });
      parsed = "hooks";
      conversationalText = out.conversationalText;
    }
  } else if (stage === "script") {
    const out = tryParse(r.content, "SCRIPT", scriptOutputSchema);
    if (out.data) {
      updatedReel = await persistScript({
        reel: args.reel,
        companyId: args.companyId,
        out: out.data,
      });
      parsed = "script";
      conversationalText = out.conversationalText;
    }
  } else if (stage === "caption") {
    const out = tryParse(r.content, "CAPTION", captionOutputSchema);
    if (out.data) {
      updatedReel = await persistCaption({
        reel: args.reel,
        companyId: args.companyId,
        out: out.data,
      });
      parsed = "caption";
      conversationalText = out.conversationalText;
    }
  } else if (stage === "broll") {
    const out = tryParse(r.content, "BROLL", brollOutputSchema);
    if (out.data) {
      updatedReel = await persistBroll({
        reel: args.reel,
        companyId: args.companyId,
        out: out.data,
      });
      parsed = "broll";
      conversationalText = out.conversationalText;
    }
  }

  return {
    assistantContent: r.content,
    conversationalText: conversationalText || r.content,
    reel: updatedReel,
    parsed,
    tokens: r.tokens,
    model: r.model,
    memoriesUsed: memories.length,
  };
}

// ─── Persistence per stage ───────────────────────────────────────────────

async function persistHooks(args: {
  reel: ReelsScriptRow;
  companyId: string;
  out: HooksOutput;
}): Promise<ReelsScriptRow> {
  return tx(async (client) => {
    // Update mutable fields (title/theme/duration only on first hooks gen)
    await client.query(
      `UPDATE public.reels_scripts
          SET title = $2, theme = $3, target_duration = $4, updated_at = now()
        WHERE id = $1 AND company_id = $5`,
      [
        args.reel.id,
        args.out.title,
        args.out.theme ?? args.reel.theme,
        args.out.target_duration,
        args.companyId,
      ],
    );
    const updated = await updateHookOptions(client, {
      id: args.reel.id,
      companyId: args.companyId,
      hooks: args.out.hooks as ReelsHookOption[],
    });
    // Transition draft → hooks_review (only if currently draft)
    if (updated.status === "draft") {
      const t = await applyTransition({
        reelId: args.reel.id,
        companyId: args.companyId,
        current: updated.status,
        event: "submit_hooks",
        client,
      });
      return t.row;
    }
    return updated;
  });
}

async function persistScript(args: {
  reel: ReelsScriptRow;
  companyId: string;
  out: ScriptOutput;
}): Promise<ReelsScriptRow> {
  return tx(async (client) => {
    // Zod .default("") in schema means parsed output has the field present,
    // but TS infers optional based on input shape. Coerce explicitly.
    const beats: ReelsBeat[] = args.out.beats.map((b) => ({
      index: b.index,
      start_seconds: b.start_seconds,
      end_seconds: b.end_seconds,
      visual: b.visual,
      on_camera_speech: b.on_camera_speech ?? "",
      on_screen_text: b.on_screen_text ?? "",
      broll_hint: b.broll_hint ?? "",
    }));
    const updated = await updateBeats(client, {
      id: args.reel.id,
      companyId: args.companyId,
      beats,
    });
    if (updated.status === "hook_picked") {
      const t = await applyTransition({
        reelId: args.reel.id,
        companyId: args.companyId,
        current: updated.status,
        event: "submit_script",
        client,
      });
      return t.row;
    }
    return updated;
  });
}

async function persistCaption(args: {
  reel: ReelsScriptRow;
  companyId: string;
  out: CaptionOutput;
}): Promise<ReelsScriptRow> {
  return tx(async (client) => {
    const updated = await updateCaption(client, {
      id: args.reel.id,
      companyId: args.companyId,
      caption: args.out.caption,
      cta: args.out.cta ?? null,
      hashtags: args.out.hashtags,
    });
    if (updated.status === "script_approved") {
      const t = await applyTransition({
        reelId: args.reel.id,
        companyId: args.companyId,
        current: updated.status,
        event: "submit_caption",
        client,
      });
      return t.row;
    }
    return updated;
  });
}

async function persistBroll(args: {
  reel: ReelsScriptRow;
  companyId: string;
  out: BrollOutput;
}): Promise<ReelsScriptRow> {
  return tx(async (client) => {
    const updated = await updateBroll(client, {
      id: args.reel.id,
      companyId: args.companyId,
      broll_suggestions: args.out.broll_suggestions,
      voice_over_script: args.out.voice_over_script,
      edit_notes: args.out.edit_notes,
    });
    if (updated.status === "caption_approved") {
      const t = await applyTransition({
        reelId: args.reel.id,
        companyId: args.companyId,
        current: updated.status,
        event: "submit_broll",
        client,
      });
      return t.row;
    }
    return updated;
  });
}

/** Pick a hook from hook_options (by index OR custom text). */
export async function pickHook(args: {
  reel: ReelsScriptRow;
  companyId: string;
  hookIndex?: number;
  customHook?: string;
}): Promise<ReelsScriptRow> {
  const hook =
    args.customHook ??
    (args.hookIndex !== undefined
      ? args.reel.hook_options[args.hookIndex]?.hook
      : null);
  if (!hook) throw new Error("hook not found");
  if (args.reel.status !== "hooks_review") {
    nextStatus(args.reel.status, "pick_hook"); // throws on invalid
  }
  return tx(async (client) => {
    const updated = await updateChosenHook(client, {
      id: args.reel.id,
      companyId: args.companyId,
      hook,
    });
    const t = await applyTransition({
      reelId: args.reel.id,
      companyId: args.companyId,
      current: updated.status,
      event: "pick_hook",
      client,
    });
    return t.row;
  });
}
