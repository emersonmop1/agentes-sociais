/**
 * InstaCreator handler — orchestrates the 4-stage carousel pipeline.
 *
 * Stage 1 (covered here): user describes a topic + visual_style → agent
 * generates slides_config (copy only, no images yet) → returned + persisted
 * to creator_posts → status = copy_review.
 *
 * Stages 2-4 land later as image search + render + caption come online.
 */

import type { VisualStyle } from "@agentes/shared";
import { z } from "zod";
import { tx } from "../../db/client.js";
import { getBrandConfig } from "../../db/repositories/brand.js";
import {
  createPost,
  listRecentTitles,
  updateSlides,
  type SlideConfig,
} from "../../db/repositories/creator-posts.js";
import { applyTransition } from "../../core/creator-state-machine.js";
import { buildAgentPrompt } from "../../core/prompt-builder.js";
import { recall, markUsed } from "../../core/memory-manager.js";
import { getDefaultProvider, type LLMMessage } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import { consumeQuota } from "../../services/quota.js";

/**
 * Thrown when a quota guard inside persistCopyAsPost rejects. The route layer
 * catches this and returns a 429. Lives here so it travels with the function
 * that throws it.
 */
export class QuotaExceededError extends Error {
  constructor(public kind: "posts" | "reels" | "youtube" | "chat") {
    super(`quota_exceeded:${kind}`);
    this.name = "QuotaExceededError";
  }
}
import { SOUL } from "./soul.js";
import { renderSystemPrompt } from "./system-prompt.js";

// ─── JSON parsing for ---SLIDES--- blocks ────────────────────────────────

const slideSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  is_cover: z.boolean().optional(),
  is_cta: z.boolean().optional(),
  image: z
    .object({
      search_query: z.string().min(1),
    })
    .optional(),
});

const copyOutputSchema = z.object({
  title: z.string().min(1).max(500),
  research_summary: z.string().optional(),
  slides: z.array(slideSchema).min(1).max(10),
});
type CopyOutput = z.infer<typeof copyOutputSchema>;

function extractSlidesBlock(text: string): { json: string; rest: string } | null {
  // Tolerant: support ---SLIDES--- delimiters with optional code fences
  const re = /---SLIDES---\s*([\s\S]*?)\s*---SLIDES---/;
  const m = text.match(re);
  if (!m) return null;
  let inner = m[1] ?? "";
  // Strip ``` fences if present
  inner = inner.replace(/```(?:json)?/g, "").trim();
  return { json: inner, rest: text.replace(re, "").trim() };
}

function tryParseCopy(text: string): {
  data: CopyOutput | null;
  conversationalText: string;
} {
  const block = extractSlidesBlock(text);
  if (!block) return { data: null, conversationalText: text };
  try {
    const parsed = JSON.parse(block.json);
    const validated = copyOutputSchema.parse(parsed);
    return { data: validated, conversationalText: block.rest };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, sample: block.json.slice(0, 200) },
      "insta-creator: failed to parse SLIDES block",
    );
    return { data: null, conversationalText: text };
  }
}

// ─── Build copy-stage prompt ──────────────────────────────────────────────

export interface RunCopyStageArgs {
  companyId: string;
  userId: string;
  /** Conversation messages so far (last user message first → last). */
  history: LLMMessage[];
  /** Visual style if the user already chose. */
  visualStyle?: VisualStyle;
  /** Free-text instructions from PreGenerateSlidesModal. */
  userInstructions?: string;
}

export interface RunCopyStageResult {
  /** The full assistant message (with the JSON block). */
  assistantContent: string;
  /** Conversational portion (without the JSON block) — used in chat UI. */
  conversationalText: string;
  /** Parsed slides if the agent emitted them. */
  copy: CopyOutput | null;
  /** Token usage. */
  tokens: { input?: number; output?: number };
  model: string;
  /** Memories that were recalled and injected. */
  memoriesUsed: number;
}

export async function runCopyStage(args: RunCopyStageArgs): Promise<RunCopyStageResult> {
  const titles = await listRecentTitles(undefined, args.companyId, 500);
  const lastUserMsg = [...args.history].reverse().find((m) => m.role === "user")?.content ?? "";

  const { memories } = await recall({
    companyId: args.companyId,
    agentSlug: "insta-creator",
    query: lastUserMsg,
  });

  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: SOUL,
    systemPrompt: renderSystemPrompt({
      stage: "copy",
      recentTitles: titles.map((t) => ({
        title: t.title,
        status: t.status,
        created_at: t.created_at,
      })),
      visualStyle: args.visualStyle,
      userInstructions: args.userInstructions,
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

  const { data, conversationalText } = tryParseCopy(r.content);
  return {
    assistantContent: r.content,
    conversationalText: conversationalText || r.content,
    copy: data,
    tokens: r.tokens,
    model: r.model,
    memoriesUsed: memories.length,
  };
}

// ─── Persist a parsed copy result to a creator_post ──────────────────────

export interface PersistCopyArgs {
  companyId: string;
  userId: string;
  visualStyle: VisualStyle;
  copy: CopyOutput;
  chatSessionId?: string;
  /** If postId given, update existing draft; otherwise create new. */
  existingPostId?: string;
}

export async function persistCopyAsPost(args: PersistCopyArgs) {
  const brand = await getBrandConfig(undefined, args.companyId);
  const brandSnapshot = brand
    ? sanitizeBrandSnapshot(brand as unknown as Record<string, unknown>)
    : { brand_name: "(sem brand)", primary_color: "#22c55e" };

  return tx(async (client) => {
    let post;
    if (args.existingPostId) {
      // Update existing draft → submit_copy will move it to copy_review
      post = await updateSlides(client, {
        id: args.existingPostId,
        companyId: args.companyId,
        slidesConfig: args.copy.slides as SlideConfig[],
      });
    } else {
      // Quota check (creates only — re-edits via existingPostId don't burn quota).
      const r = await consumeQuota(client, args.companyId, "posts");
      if (!r.ok) throw new QuotaExceededError("posts");

      post = await createPost(client, {
        companyId: args.companyId,
        createdBy: args.userId,
        title: args.copy.title.slice(0, 500),
        visualStyle: args.visualStyle,
        brandSnapshot,
        chatSessionId: args.chatSessionId,
      });
      post = await updateSlides(client, {
        id: post.id,
        companyId: args.companyId,
        slidesConfig: args.copy.slides as SlideConfig[],
        researchData: { summary: args.copy.research_summary ?? null },
      });
    }

    const transitioned = await applyTransition({
      postId: post.id,
      companyId: args.companyId,
      current: post.status,
      event: "submit_copy",
      client,
    });

    return transitioned.post;
  });
}

function sanitizeBrandSnapshot(brand: Record<string, unknown>): Record<string, unknown> {
  // Drop noisy/unused fields, keep what slide rendering will need later
  const allow = [
    "brand_name",
    "niche",
    "instagram_handle",
    "logo_url",
    "avatar_url",
    "badge_verified",
    "primary_color",
    "secondary_color",
    "accent_color",
    "background_color",
    "text_color",
    "font_family_heading",
    "font_family_body",
    "voice_tone",
    "signature_phrases",
    "default_visual_style",
  ];
  const out: Record<string, unknown> = {};
  for (const k of allow) if (k in brand) out[k] = brand[k];
  return out;
}
