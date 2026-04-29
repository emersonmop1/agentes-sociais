/**
 * YouTubeGrowth handler — runs ideation and thumb-strategist stages.
 *
 * Both stages are direct calls (not chat) — the user clicks "generate" and
 * the agent produces JSON output. The pipeline lives in the route handlers
 * which call these and persist.
 */

import { z } from "zod";
import {
  type YouTubeChapter,
  type YouTubeCitedVideo,
  type YouTubeEndScreenVideo,
  type YouTubeProjectRow,
  type YouTubeThumbnailConcept,
} from "../../db/repositories/youtube-projects.js";
import { recall, markUsed } from "../../core/memory-manager.js";
import { buildAgentPrompt } from "../../core/prompt-builder.js";
import { getDefaultProvider } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import { SOUL } from "./soul.js";
import {
  renderIdeationPrompt,
  renderThumbPrompt,
  type IdeationContext,
  type ThumbContext,
} from "./system-prompt.js";

// ─── Output schemas ──────────────────────────────────────────────────────

const ideationSchema = z.object({
  title_options: z.array(z.string().min(1).max(150)).min(3).max(8),
  top_3_titles: z.array(z.string().min(1).max(150)).min(1).max(4),
  description: z.string().min(50).max(5000),
  tags: z.array(z.string().min(1).max(50)).min(3).max(30),
  chapters: z
    .array(
      z.object({
        timestamp: z.string().regex(/^\d{1,2}:\d{2}$/),
        title: z.string().min(1).max(80),
      }),
    )
    .min(3)
    .max(20),
  cited_videos: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        url: z.string().optional().default(""),
      }),
    )
    .max(20),
  end_screen_videos: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        reason: z.string().min(1).max(300),
      }),
    )
    .min(2)
    .max(5),
});

const thumbsSchema = z.object({
  concepts: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        subject: z.string().min(3).max(300),
        hook_text: z.string().max(50).default(""),
        emotion: z.string().min(2).max(80),
        color_palette: z.array(z.string()).max(8),
        composition: z.string().max(300),
        image_prompt: z.string().min(20).max(2000),
        use_creator_face: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(6),
});

function extractBlock(text: string, marker: string): string | null {
  const re = new RegExp(`---${marker}---\\s*([\\s\\S]*?)\\s*---${marker}---`);
  const m = text.match(re);
  if (!m) return null;
  let inner = m[1] ?? "";
  inner = inner.replace(/```(?:json)?/g, "").trim();
  return inner;
}

function tryParse<S extends z.ZodTypeAny>(
  text: string,
  marker: string,
  schema: S,
): z.output<S> | null {
  const inner = extractBlock(text, marker);
  if (!inner) return null;
  try {
    return schema.parse(JSON.parse(inner));
  } catch (err) {
    logger.warn(
      { marker, err: (err as Error).message, sample: inner.slice(0, 300) },
      "youtube-growth: failed to parse",
    );
    return null;
  }
}

// ─── Ideation ────────────────────────────────────────────────────────────

export interface IdeationResult {
  title_options: string[];
  top_3_titles: string[];
  description: string;
  tags: string[];
  chapters: YouTubeChapter[];
  cited_videos: YouTubeCitedVideo[];
  end_screen_videos: YouTubeEndScreenVideo[];
  tokens: { input?: number; output?: number };
  model: string;
}

export async function runIdeation(args: {
  companyId: string;
  project: YouTubeProjectRow;
}): Promise<IdeationResult> {
  if (!args.project.transcript || args.project.transcript.length < 50) {
    throw new Error("project has no usable transcript");
  }

  const ctx: IdeationContext = {
    transcript: args.project.transcript,
    video_duration_s: args.project.video_duration_s ?? undefined,
  };

  const { memories } = await recall({
    companyId: args.companyId,
    agentSlug: "youtube-growth",
    query: args.project.transcript.slice(0, 2000),
  });

  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: SOUL,
    systemPrompt: renderIdeationPrompt(ctx),
    memories,
  });

  const r = await getDefaultProvider().chat(
    [{ role: "user", content: "Gere agora o ideation completo no formato JSON pedido." }],
    {
      system: systemPrompt,
      tier: "pro",
      temperature: 0.75,
      maxOutputTokens: 6000,
    },
  );
  if (memories.length > 0) {
    void markUsed(memories.map((m) => m.id)).catch(() => undefined);
  }

  const parsed = tryParse(r.content, "IDEATION", ideationSchema);
  if (!parsed) {
    throw new Error(
      "Ideation parse failed — model returned malformed JSON. " +
        r.content.slice(0, 200),
    );
  }

  return {
    title_options: parsed.title_options,
    top_3_titles: parsed.top_3_titles,
    description: parsed.description,
    tags: parsed.tags,
    chapters: parsed.chapters as YouTubeChapter[],
    cited_videos: parsed.cited_videos.map((v) => ({
      title: v.title,
      url: v.url || undefined,
    })) as YouTubeCitedVideo[],
    end_screen_videos: parsed.end_screen_videos as YouTubeEndScreenVideo[],
    tokens: r.tokens,
    model: r.model,
  };
}

// ─── Thumb concepts ──────────────────────────────────────────────────────

export interface ThumbConceptsResult {
  concepts: YouTubeThumbnailConcept[];
  tokens: { input?: number; output?: number };
  model: string;
}

export async function runThumbStrategist(args: {
  companyId: string;
  project: YouTubeProjectRow;
  primaryColor?: string;
}): Promise<ThumbConceptsResult> {
  if (!args.project.chosen_title) {
    throw new Error("project has no chosen_title");
  }

  const ctx: ThumbContext = {
    chosen_title: args.project.chosen_title,
    transcript_summary:
      args.project.transcript_summary ??
      args.project.transcript?.slice(0, 1500) ??
      "",
    use_creator_face: args.project.use_creator_face,
    primary_color: args.primaryColor,
  };

  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: SOUL,
    systemPrompt: renderThumbPrompt(ctx),
    memories: [],
  });

  const r = await getDefaultProvider().chat(
    [{ role: "user", content: "Gere agora os 4 conceitos de thumbnail no formato JSON pedido." }],
    {
      system: systemPrompt,
      tier: "pro",
      temperature: 0.85,
      maxOutputTokens: 4000,
    },
  );

  const parsed = tryParse(r.content, "THUMBS", thumbsSchema);
  if (!parsed) {
    throw new Error(
      "Thumb concepts parse failed. " + r.content.slice(0, 200),
    );
  }

  return {
    concepts: parsed.concepts.map((c) => ({
      index: c.index,
      subject: c.subject,
      hook_text: c.hook_text,
      emotion: c.emotion,
      color_palette: c.color_palette,
      composition: c.composition,
      image_prompt: c.image_prompt,
      use_creator_face: c.use_creator_face,
    })),
    tokens: r.tokens,
    model: r.model,
  };
}
