/**
 * Insta Creator routes — `/api/insta-creator/*`.
 *
 * The shape of the API is split between:
 *   • A "chat" endpoint that drives the conversation with the agent and,
 *     when the agent emits a parsed slides block, persists it as a post.
 *   • CRUD-style endpoints for posts (kanban view, detail, transitions).
 *
 * Stage 2+ endpoints (generate-slides, regenerate-slide, publish) come online
 * as Phase C of Fatia 3 lands.
 */

import { visualStyleSchema, type VisualStyle } from "@agentes/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runCaptionStage } from "../../agents/insta-creator/caption-handler.js";
import {
  persistCopyAsPost,
  QuotaExceededError,
  runCopyStage,
} from "../../agents/insta-creator/handler.js";
import { applyTransition, nextStatus } from "../../core/creator-state-machine.js";
import { tx } from "../../db/client.js";
import { recordExecution } from "../../db/repositories/executions.js";
import {
  appendMessage,
  listMessages,
} from "../../db/repositories/chat.js";
import {
  deletePost,
  getPostById,
  listPosts,
  patchSlide,
  updateCaption,
  updateSlides,
  type CreatorPostRow,
  type CreatorPostStatus,
  type SlideConfig,
} from "../../db/repositories/creator-posts.js";
import {
  createRenderJob,
  getLatestRenderJobForPost,
} from "../../db/repositories/render-jobs.js";
import {
  createPublishJob,
  getLatestPublishJobForPost,
} from "../../db/repositories/publish-jobs.js";
import { getToken } from "../../db/repositories/integrations.js";
import {
  createSession,
  getSession,
} from "../../db/repositories/sessions.js";
import { searchFirstImage } from "../../services/image-search.js";
import { generateImage } from "../../services/image-generator.js";
import { fetchSlideImage } from "../../services/image-source.js";
import { planUniqueTopics } from "../../services/content-supervisor.js";
import { getQuotaSnapshot } from "../../services/quota.js";
import { logger } from "../../lib/logger.js";
import type { LLMMessage } from "../../lib/llm/index.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const instaCreatorRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── POST /api/insta-creator/chat ── chat with InstaCreator agent ───────────
const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  /** If chatting in an existing session, otherwise creates one. */
  session_id: z.string().uuid().optional(),
  /** Visual style if user is committing on this turn. */
  visual_style: visualStyleSchema.optional(),
  /** Free-text instructions from PreGenerateSlidesModal. */
  user_instructions: z.string().max(2000).optional(),
});

instaCreatorRoutes.post("/chat", async (c) => {
  const startedAt = Date.now();
  const body = chatBodySchema.parse(await c.req.json());
  const { companyId } = c.var.company;
  const { userId } = c.var.auth;

  // 1. Ensure session
  let sessionId = body.session_id;
  if (sessionId) {
    const existing = await getSession(undefined, sessionId, companyId);
    if (!existing) return c.json({ error: "session_not_found" }, 404);
    if (existing.agent_slug !== "insta-creator") {
      return c.json({ error: "wrong_agent_for_session" }, 400);
    }
  } else {
    const fresh = await createSession(undefined, {
      companyId,
      userId,
      agentSlug: "insta-creator",
      sessionType: "insta_creator",
      title: body.message.slice(0, 60),
    });
    sessionId = fresh.id;
  }

  // 2. Append user message + load history
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

  // 3. Run the copy stage agent
  const result = await runCopyStage({
    companyId,
    userId,
    history: llmHistory,
    visualStyle: body.visual_style,
    userInstructions: body.user_instructions,
  });

  // 4. Persist agent message
  const assistantMsgId = await appendMessage(undefined, {
    sessionId,
    role: "assistant",
    content: result.assistantContent,
    tokensUsed: result.tokens,
    providerModel: result.model,
    metadata: result.copy
      ? { has_copy: true, slide_count: result.copy.slides.length }
      : { has_copy: false },
  });

  // 5. If parsed copy exists → create/update post + transition
  let post: CreatorPostRow | null = null;
  let quotaExceeded = false;
  if (result.copy) {
    const visualStyle: VisualStyle = body.visual_style ?? "tweet_thread";
    try {
      post = await persistCopyAsPost({
        companyId,
        userId,
        visualStyle,
        copy: result.copy,
        chatSessionId: sessionId,
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        quotaExceeded = true;
        logger.warn({ companyId }, "insta-creator: posts quota exceeded");
      } else {
        logger.error({ err: (err as Error).message }, "persistCopyAsPost failed");
      }
    }
  }

  void recordExecution(undefined, {
    companyId,
    agentSlug: "insta-creator",
    sessionId,
    trigger: "chat",
    provider: "gemini",
    model: result.model,
    tokensInput: result.tokens.input,
    tokensOutput: result.tokens.output,
    latencyMs: Date.now() - startedAt,
    memoriesRecalled: result.memoriesUsed,
    metadata: { post_created: post?.id ?? null, slides_count: post?.slides_count ?? 0 },
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
    post: post ? toPostApi(post) : null,
    memories_used: result.memoriesUsed,
    quota_exceeded: quotaExceeded,
  });
});

// ─── GET /api/insta-creator/posts ──────────────────────────────────────────
instaCreatorRoutes.get("/posts", async (c) => {
  const status = c.req.query("status") as CreatorPostStatus | undefined;
  const rows = await listPosts(undefined, {
    companyId: c.var.company.companyId,
    status,
  });
  return c.json({ posts: rows.map(toPostApi) });
});

// ─── GET /api/insta-creator/kanban ─────────────────────────────────────────
const KANBAN_BUCKETS: Record<string, CreatorPostStatus[]> = {
  draft: ["draft"],
  copy_review: ["copy_review"],
  copy_approved: ["copy_approved"],
  design_review: ["design_review"],
  design_approved: ["design_approved"],
  caption_review: ["caption_review"],
  caption_approved: ["caption_approved"],
  final_review: ["final_review"],
  ready: ["ready", "scheduled"],
  publishing: ["publishing"],
  published: ["published"],
  failed: ["publish_failed", "rejected"],
};

instaCreatorRoutes.get("/kanban", async (c) => {
  const rows = await listPosts(undefined, {
    companyId: c.var.company.companyId,
    limit: 200,
  });
  const buckets: Record<string, ReturnType<typeof toPostApi>[]> = {};
  for (const key of Object.keys(KANBAN_BUCKETS)) buckets[key] = [];
  for (const row of rows) {
    for (const [key, statuses] of Object.entries(KANBAN_BUCKETS)) {
      if (statuses.includes(row.status)) {
        buckets[key]!.push(toPostApi(row));
        break;
      }
    }
  }
  return c.json({ buckets });
});

// ─── GET /api/insta-creator/posts/:id ──────────────────────────────────────
instaCreatorRoutes.get("/posts/:id", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  return c.json({ post: toPostDetailApi(post) });
});

// ─── DELETE /api/insta-creator/posts/:id ───────────────────────────────────
instaCreatorRoutes.delete("/posts/:id", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  await deletePost(undefined, post.id, c.var.company.companyId);
  return c.json({ ok: true });
});

// ─── POST /api/insta-creator/posts/:id/approve ─────────────────────────────
instaCreatorRoutes.post("/posts/:id/approve", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);

  // Pick the right event by current status
  const event =
    post.status === "copy_review"
      ? "approve"
      : post.status === "design_review"
        ? "approve"
        : post.status === "caption_review"
          ? "approve"
          : post.status === "final_review"
            ? "approve_final"
            : null;
  if (!event) {
    return c.json({ error: "invalid_state", current: post.status }, 409);
  }

  try {
    nextStatus(post.status, event);
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }

  const result = await applyTransition({
    postId: post.id,
    companyId: post.company_id,
    current: post.status,
    event,
  });
  return c.json({ post: toPostApi(result.post), description: result.description });
});

// ─── POST /api/insta-creator/posts/:id/reject ──────────────────────────────
const rejectBodySchema = z.object({
  feedback: z.string().min(1).max(2000),
});

instaCreatorRoutes.post("/posts/:id/reject", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  const body = rejectBodySchema.parse(await c.req.json());

  try {
    const result = await applyTransition({
      postId: post.id,
      companyId: post.company_id,
      current: post.status,
      event: "reject",
      rejectionFeedback: body.feedback,
    });
    return c.json({ post: toPostApi(result.post), description: result.description });
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }
});

// ─── POST /api/insta-creator/posts/:id/kill ── kill switch ──────────────────
instaCreatorRoutes.post("/posts/:id/kill", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  const result = await applyTransition({
    postId: post.id,
    companyId: post.company_id,
    current: post.status,
    event: "kill",
  });
  return c.json({ post: toPostApi(result.post), description: result.description });
});

// ─── POST /api/insta-creator/posts/:id/generate-slides ──────────────────────
// Stage 2 of the pipeline. Pre-conditions: post must be in copy_approved.
// Behavior:
//   1. For every slide that needs an image, dispatch via fetchSlideImage:
//        • dark            → Gemini Image (cinematic generation)
//        • tweet_thread    → image-search (Unsplash/Pexels/Picsum fallback)
//        • tweet_single    → image-search
//        • acid_text       → null (text-only)
//   2. Persist the updated slides_config.
//   3. Enqueue a creator_render_jobs row covering all slides.
//   4. Worker picks it up, renders, uploads, and transitions to design_review.
instaCreatorRoutes.post("/posts/:id/generate-slides", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (post.status !== "copy_approved") {
    return c.json(
      { error: "invalid_state", message: "post must be in copy_approved", current: post.status },
      409,
    );
  }

  const brand = post.brand_snapshot as { primary_color?: string; accent_color?: string };

  // Image fetch per slide (parallel; failures don't break the whole post)
  const updatedSlides: SlideConfig[] = await Promise.all(
    post.slides_config.map(async (slide) => {
      // Skip if already has url
      if (slide.image?.url) return slide;
      try {
        const found = await fetchSlideImage({
          postId: post.id,
          companyId: c.var.company.companyId,
          visualStyle: post.visual_style,
          slide,
          brand,
        });
        if (!found) return slide;
        return {
          ...slide,
          image: {
            ...slide.image,
            search_query: slide.image?.search_query ?? "",
            url: found.url,
            credit: found.credit,
            width: found.width,
            height: found.height,
            source: post.visual_style === "dark" ? "gemini" : "unsplash",
          },
        };
      } catch (err) {
        logger.warn(
          { slideIndex: slide.index, err: (err as Error).message },
          "fetchSlideImage failed",
        );
        return slide;
      }
    }),
  );

  await updateSlides(undefined, {
    id: post.id,
    companyId: c.var.company.companyId,
    slidesConfig: updatedSlides,
  });

  const job = await createRenderJob(undefined, {
    postId: post.id,
    companyId: c.var.company.companyId,
    slideIndexes: [],
  });

  return c.json({
    job_id: job.id,
    status: job.status,
    slides_with_images: updatedSlides.filter((s) => Boolean(s.image?.url)).length,
    total_slides: updatedSlides.length,
  });
});

// ─── POST /api/insta-creator/posts/:id/slides/:idx/regenerate-image ──────────
// Re-fetch (or re-generate) the image for a single slide. Optionally takes a
// custom prompt that fully overrides the agent-provided search_query — useful
// when the user wants a specific look. After the image swap we ALSO enqueue
// a single-slide render job so the user immediately sees the updated PNG.
const regenImageBodySchema = z.object({
  prompt: z.string().min(3).max(500).optional(),
  /** When true, use the image generator regardless of visual_style. */
  force_generate: z.boolean().optional(),
});

instaCreatorRoutes.post("/posts/:id/slides/:idx/regenerate-image", async (c) => {
  const postId = c.req.param("id");
  const idx = Number.parseInt(c.req.param("idx"), 10);
  if (!Number.isInteger(idx) || idx < 0) return c.json({ error: "bad_index" }, 400);

  const post = await getPostById(undefined, postId, c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (idx >= post.slides_config.length) return c.json({ error: "bad_index" }, 400);

  const body = regenImageBodySchema.parse(await c.req.json().catch(() => ({})));
  const slide = post.slides_config[idx]!;
  const brand = post.brand_snapshot as { primary_color?: string; accent_color?: string };

  // Decide source. force_generate OR dark style → generator. Custom prompt
  // strongly implies the user wants generation.
  const useGenerator =
    Boolean(body.force_generate) ||
    Boolean(body.prompt) ||
    post.visual_style === "dark";

  let found;
  try {
    if (useGenerator) {
      found = await generateImage({
        query: slide.image?.search_query ?? slide.title,
        customPrompt: body.prompt,
        style: post.visual_style === "acid_text" ? "dark" : post.visual_style,
        accentColor: brand.accent_color ?? brand.primary_color,
        storagePath: `${c.var.company.companyId}/${post.id}/slide_${String(idx).padStart(2, "0")}_${Date.now()}`,
      });
    } else {
      const result = await fetchSlideImage({
        postId: post.id,
        companyId: c.var.company.companyId,
        visualStyle: post.visual_style,
        slide,
        brand,
      });
      if (!result) return c.json({ error: "no_image_found" }, 404);
      found = result;
    }
  } catch (err) {
    logger.error({ err: (err as Error).message, postId, idx }, "regenerate-image failed");
    return c.json({ error: "regenerate_failed", message: (err as Error).message }, 500);
  }

  // Persist the new image into the slide
  const newSlides: SlideConfig[] = post.slides_config.map((s) =>
    s.index === idx
      ? {
          ...s,
          image: {
            ...s.image,
            search_query: s.image?.search_query ?? "",
            url: found.url,
            credit: found.credit,
            width: found.width,
            height: found.height,
            source: useGenerator ? "gemini" : "unsplash",
          },
          // Drop the old rendered_url so the kanban card / preview falls back
          // to the new raw image until the worker re-renders.
          rendered_url: null,
          rendered_at: null,
        }
      : s,
  );

  await updateSlides(undefined, {
    id: post.id,
    companyId: c.var.company.companyId,
    slidesConfig: newSlides,
  });

  // Enqueue a re-render of just this slide
  const job = await createRenderJob(undefined, {
    postId: post.id,
    companyId: c.var.company.companyId,
    slideIndexes: [idx],
  });

  return c.json({
    image: { url: found.url, credit: found.credit },
    job_id: job.id,
    used_generator: useGenerator,
  });
});

// ─── GET /api/insta-creator/posts/:id/render-status ─────────────────────────
// Used by the frontend to poll progress while the worker renders.
instaCreatorRoutes.get("/posts/:id/render-status", async (c) => {
  const postId = c.req.param("id");
  const post = await getPostById(undefined, postId, c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  const job = await getLatestRenderJobForPost(undefined, postId, c.var.company.companyId);
  return c.json({
    post_status: post.status,
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          error: job.error,
          slides_rendered: job.output_urls.length,
          created_at: job.created_at,
          completed_at: job.completed_at,
        }
      : null,
    slides_config: post.slides_config,
  });
});

// ─── PATCH /api/insta-creator/posts/:id/slides/:idx ─────────────────────────
// User-side slide editing (text changes, image swap).
const slidePatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  subtitle: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
  image: z
    .object({
      search_query: z.string().max(300).optional(),
      url: z.string().url().optional(),
      credit: z.string().max(300).optional(),
    })
    .optional()
    .nullable(),
});

instaCreatorRoutes.patch("/posts/:id/slides/:idx", async (c) => {
  const postId = c.req.param("id");
  const idx = Number.parseInt(c.req.param("idx"), 10);
  if (!Number.isInteger(idx) || idx < 0) {
    return c.json({ error: "bad_index" }, 400);
  }
  const body = slidePatchSchema.parse(await c.req.json());
  try {
    const updated = await patchSlide(undefined, {
      id: postId,
      companyId: c.var.company.companyId,
      index: idx,
      patch: body as Partial<SlideConfig>,
    });
    return c.json({ post: toPostDetailApi(updated) });
  } catch (err) {
    return c.json({ error: "patch_failed", message: (err as Error).message }, 400);
  }
});

// ─── POST /api/insta-creator/posts/:id/regenerate-slide/:idx ────────────────
// Re-render a single slide. Useful when the user swaps the image_url manually
// or edits text after the initial render.
instaCreatorRoutes.post("/posts/:id/regenerate-slide/:idx", async (c) => {
  const postId = c.req.param("id");
  const idx = Number.parseInt(c.req.param("idx"), 10);
  if (!Number.isInteger(idx) || idx < 0) {
    return c.json({ error: "bad_index" }, 400);
  }
  const post = await getPostById(undefined, postId, c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (idx >= post.slides_config.length) {
    return c.json({ error: "bad_index" }, 400);
  }
  const job = await createRenderJob(undefined, {
    postId,
    companyId: c.var.company.companyId,
    slideIndexes: [idx],
  });
  return c.json({ job_id: job.id, status: job.status });
});

// ─── POST /api/insta-creator/posts/:id/caption/generate ──── Etapa 3 ────────
// Generates caption + first_comment + hashtags for an approved-design post.
// Pre-condition: status === 'design_approved'. Persists outputs and
// transitions to caption_review.
instaCreatorRoutes.post("/posts/:id/caption/generate", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (post.status !== "design_approved") {
    return c.json(
      { error: "invalid_state", message: "post must be in design_approved", current: post.status },
      409,
    );
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await runCaptionStage({ post });
  } catch (err) {
    logger.error({ err: (err as Error).message, postId: post.id }, "caption gen failed");
    return c.json({ error: "caption_gen_failed", message: (err as Error).message }, 500);
  }

  // Persist + transition in one tx
  const updated = await tx(async (client) => {
    await updateCaption(client, {
      id: post.id,
      companyId: post.company_id,
      caption: result.caption.caption,
      firstComment: result.caption.first_comment ?? null,
      hashtags: result.caption.hashtags,
    });
    const transitioned = await applyTransition({
      postId: post.id,
      companyId: post.company_id,
      current: post.status,
      event: "submit_caption",
      client,
    });
    return transitioned.post;
  });

  void recordExecution(undefined, {
    companyId: post.company_id,
    agentSlug: "insta-creator",
    sessionId: post.chat_session_id,
    trigger: "pipeline_step",
    provider: "gemini",
    model: result.model,
    tokensInput: result.tokens.input,
    tokensOutput: result.tokens.output,
    latencyMs: Date.now() - startedAt,
    memoriesRecalled: result.memoriesUsed,
    metadata: { stage: "caption" },
  });

  return c.json({
    post: toPostDetailApi(updated),
    caption: result.caption,
  });
});

// ─── PATCH /api/insta-creator/posts/:id/caption ──── manual edit ────────────
const captionPatchSchema = z.object({
  caption: z.string().max(4000).optional(),
  first_comment: z.string().max(2000).nullable().optional(),
  hashtags: z.array(z.string()).max(50).optional(),
});

instaCreatorRoutes.patch("/posts/:id/caption", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  const body = captionPatchSchema.parse(await c.req.json());
  const updated = await updateCaption(undefined, {
    id: post.id,
    companyId: post.company_id,
    caption: body.caption ?? post.caption,
    firstComment:
      body.first_comment === undefined ? post.first_comment : body.first_comment,
    hashtags: body.hashtags ?? post.hashtags,
  });
  return c.json({ post: toPostDetailApi(updated) });
});

// ─── POST /api/insta-creator/posts/:id/submit-final ──── Etapa 4 entry ──────
// User clicks "send to final review" after approving caption. caption_approved → final_review.
instaCreatorRoutes.post("/posts/:id/submit-final", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  try {
    const result = await applyTransition({
      postId: post.id,
      companyId: post.company_id,
      current: post.status,
      event: "submit_final",
    });
    return c.json({ post: toPostApi(result.post), description: result.description });
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }
});

// ─── POST /api/insta-creator/posts/:id/manual-publish ────────────────────────
// Manual publish — user posted to Instagram themselves and wants to mark as
// published. Skips the OAuth Graph API flow entirely. Useful for v1 before
// Facebook App Review is approved.
const manualPublishSchema = z.object({
  external_post_url: z.string().url().optional(),
  external_post_id: z.string().max(200).optional(),
});

instaCreatorRoutes.post("/posts/:id/manual-publish", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (!["ready", "scheduled", "publish_failed"].includes(post.status)) {
    return c.json(
      { error: "invalid_state", message: "post must be ready or scheduled", current: post.status },
      409,
    );
  }
  const body = manualPublishSchema.parse(await c.req.json());
  const updated = await tx(async (client) => {
    await client.query(
      `UPDATE public.creator_posts
          SET status = 'published'::public.creator_post_status,
              published_at = now(),
              external_post_url = COALESCE($2, external_post_url),
              external_post_id  = COALESCE($3, external_post_id),
              updated_at = now()
        WHERE id = $1 AND company_id = $4`,
      [
        post.id,
        body.external_post_url ?? null,
        body.external_post_id ?? null,
        post.company_id,
      ],
    );
    const r = await client.query(
      `SELECT * FROM public.creator_posts WHERE id = $1`,
      [post.id],
    );
    return r.rows[0] as CreatorPostRow;
  });
  return c.json({ post: toPostDetailApi(updated) });
});

// ─── POST /api/insta-creator/posts/:id/publish ── Graph API publish ─────────
// Pre-condition: status === ready (or publish_failed for retry).
// Creates a creator_publish_jobs row; the worker leases and executes it.
const publishBodySchema = z.object({
  scheduled_for: z.string().datetime().optional(),
});

instaCreatorRoutes.post("/posts/:id/publish", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  if (!["ready", "publish_failed"].includes(post.status)) {
    return c.json(
      { error: "invalid_state", message: "post must be ready or publish_failed", current: post.status },
      409,
    );
  }
  if (post.slides_config.length === 0 || !post.slides_config.every((s) => s.rendered_url)) {
    return c.json({ error: "slides_not_ready", message: "all slides must have rendered_url" }, 400);
  }
  if (!post.caption || post.caption.length === 0) {
    return c.json({ error: "caption_missing", message: "post must have a caption to publish" }, 400);
  }

  // Verify Instagram is connected
  const tk = await getToken(undefined, c.var.company.companyId, "instagram_graph");
  if (!tk || tk.invalid) {
    return c.json(
      {
        error: "instagram_not_connected",
        message: tk?.invalid_reason ?? "Conecte Instagram em Integrações antes de publicar.",
      },
      400,
    );
  }

  const body = publishBodySchema.parse(await c.req.json().catch(() => ({})));
  const scheduledFor = body.scheduled_for ? new Date(body.scheduled_for) : null;

  const updated = await tx(async (client) => {
    const job = await createPublishJob(client, {
      postId: post.id,
      companyId: post.company_id,
      scheduledFor,
    });
    // Move the post to publishing (immediate) or scheduled (future)
    const targetStatus = scheduledFor && scheduledFor.getTime() > Date.now() ? "scheduled" : "publishing";
    const targetEvent = targetStatus === "scheduled" ? "schedule" : "publish_now";
    const transitioned = await applyTransition({
      postId: post.id,
      companyId: post.company_id,
      current: post.status,
      event: targetEvent,
      client,
    });
    if (scheduledFor) {
      await client.query(
        `UPDATE public.creator_posts SET scheduled_at = $2 WHERE id = $1`,
        [post.id, scheduledFor.toISOString()],
      );
    }
    return { post: transitioned.post, job };
  });

  return c.json({
    post: toPostApi(updated.post),
    job_id: updated.job.id,
    scheduled: Boolean(scheduledFor),
  });
});

// ─── GET /api/insta-creator/posts/:id/publish-status ───────────────────────
instaCreatorRoutes.get("/posts/:id/publish-status", async (c) => {
  const postId = c.req.param("id");
  const post = await getPostById(undefined, postId, c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);
  const job = await getLatestPublishJobForPost(undefined, postId, c.var.company.companyId);
  return c.json({
    post_status: post.status,
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          error: job.error,
          scheduled_for: job.scheduled_for,
          completed_at: job.completed_at,
        }
      : null,
    external_post_url: post.external_post_url,
    external_post_id: post.external_post_id,
  });
});

// ─── POST /api/insta-creator/quick-flow ── batch-generate N unique posts ────
//
// Returns Server-Sent Events:
//   event: planned    data: { topics: [...] }
//   event: post       data: { index, total, post: { ... } }
//   event: skipped    data: { index, total, reason: "quota_exceeded" | "agent_failed" }
//   event: done       data: { generated, skipped }
//   event: error      data: { message }
//
// We don't run renders here — each post lands at status=copy_review and the
// user approves/edits/regenerates from the kanban as usual. The "Quick Flow"
// is just a way to seed the kanban with N starter drafts in one click.
const quickFlowSchema = z.object({
  count: z.number().int().min(1).max(5),
  visual_style: visualStyleSchema.optional(),
  /** Optional theme/seed (e.g. "produtividade pra dev"). */
  seed: z.string().max(500).optional(),
});

instaCreatorRoutes.post("/quick-flow", async (c) => {
  const body = quickFlowSchema.parse(await c.req.json());
  const { companyId } = c.var.company;
  const { userId } = c.var.auth;

  // Pre-flight: do we even have N quota slots available? Block early so we
  // don't burn an LLM call planning topics that we can't post.
  const snap = await getQuotaSnapshot(undefined, companyId);
  if (!snap || snap.posts_quota_remaining < body.count) {
    return c.json(
      {
        error: "insufficient_quota",
        kind: "posts" as const,
        remaining: snap?.posts_quota_remaining ?? 0,
        requested: body.count,
        message: `Você tem ${snap?.posts_quota_remaining ?? 0} carrosséis disponíveis no ciclo (pediu ${body.count}).`,
      },
      429,
    );
  }

  return streamSSE(c, async (stream) => {
    let heartbeat: NodeJS.Timeout | undefined;
    let generated = 0;
    let skipped = 0;
    try {
      heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => undefined);
      }, 15_000);
      heartbeat.unref?.();

      // 1. Plan unique topics
      const plan = await planUniqueTopics({
        companyId,
        count: body.count,
        seed: body.seed,
      });
      await stream.writeSSE({
        event: "planned",
        data: JSON.stringify({ topics: plan.topics }),
      });

      const visualStyle: VisualStyle = body.visual_style ?? "tweet_thread";

      // 2. For each topic, create a session + run the copy stage + persist
      for (let i = 0; i < plan.topics.length; i += 1) {
        const topic = plan.topics[i];
        if (!topic) continue;
        const userMsg = `Tema: ${topic.title}\nÂngulo: ${topic.angle}\n\nGere o carrossel agora — apenas o JSON ---SLIDES--- e nada mais.`;

        // Session per post so each can be inspected later in the kanban
        const session = await createSession(undefined, {
          companyId,
          userId,
          agentSlug: "insta-creator",
          sessionType: "insta_creator",
          title: topic.title.slice(0, 60),
        });
        await appendMessage(undefined, {
          sessionId: session.id,
          role: "user",
          content: userMsg,
        });

        const llmHistory: LLMMessage[] = [{ role: "user", content: userMsg }];

        try {
          const result = await runCopyStage({
            companyId,
            userId,
            history: llmHistory,
            visualStyle,
          });

          await appendMessage(undefined, {
            sessionId: session.id,
            role: "assistant",
            content: result.assistantContent,
            tokensUsed: result.tokens,
            providerModel: result.model,
          });

          if (!result.copy) {
            skipped += 1;
            await stream.writeSSE({
              event: "skipped",
              data: JSON.stringify({
                index: i,
                total: plan.topics.length,
                reason: "agent_no_copy",
                topic_title: topic.title,
              }),
            });
            continue;
          }

          let post;
          try {
            post = await persistCopyAsPost({
              companyId,
              userId,
              visualStyle,
              copy: result.copy,
              chatSessionId: session.id,
            });
          } catch (err) {
            if (err instanceof QuotaExceededError) {
              skipped += 1;
              await stream.writeSSE({
                event: "skipped",
                data: JSON.stringify({
                  index: i,
                  total: plan.topics.length,
                  reason: "quota_exceeded",
                  topic_title: topic.title,
                }),
              });
              break; // No point continuing if quota is gone
            }
            throw err;
          }

          generated += 1;
          await stream.writeSSE({
            event: "post",
            data: JSON.stringify({
              index: i,
              total: plan.topics.length,
              post: toPostApi(post),
            }),
          });
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, topic: topic.title },
            "quick-flow: topic failed",
          );
          skipped += 1;
          await stream.writeSSE({
            event: "skipped",
            data: JSON.stringify({
              index: i,
              total: plan.topics.length,
              reason: "agent_failed",
              topic_title: topic.title,
              error: (err as Error).message.slice(0, 200),
            }),
          });
        }
      }

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ generated, skipped }),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, "quick-flow error");
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (err as Error).message }),
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  });
});

// ─── GET /api/insta-creator/posts/:id/timeline ───────────────────────────────
//
// Cross-table audit feed for a single post. Aggregates events in chronological
// order from:
//   • chat_messages          (user prompts + assistant responses)
//   • agent_executions       (LLM calls — provider, model, tokens, latency)
//   • creator_render_jobs    (Playwright render tasks per slide-batch)
//   • creator_publish_jobs   (Graph API publish + retries)
//
// One round-trip — UNION ALL on the server with a single ORDER BY at_ts.
// Bound LIMIT 200 because timelines for old high-revision posts can grow
// long; the UI shows newest-first and offers "load older" later if needed.
instaCreatorRoutes.get("/posts/:id/timeline", async (c) => {
  const post = await getPostById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!post) return c.json({ error: "not_found" }, 404);

  const sql = `
    SELECT * FROM (
      SELECT
        'chat_message' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'role', role,
          'content', content,
          'tokens_used', tokens_used,
          'provider_model', provider_model
        ) AS data
        FROM public.chat_messages
       WHERE session_id = $2

      UNION ALL

      SELECT
        'agent_execution' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'agent_slug', agent_slug,
          'trigger', trigger,
          'provider', provider,
          'model', model,
          'tokens_input', tokens_input,
          'tokens_output', tokens_output,
          'latency_ms', latency_ms,
          'status', status,
          'error_message', error_message,
          'memories_recalled', memories_recalled,
          'memories_stored', memories_stored
        ) AS data
        FROM public.agent_executions
       WHERE session_id = $2

      UNION ALL

      SELECT
        'render_job' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'status', status,
          'slide_indexes', slide_indexes,
          'attempts', attempts,
          'error', error,
          'output_count', array_length(output_urls, 1),
          'started_at', started_at,
          'completed_at', completed_at
        ) AS data
        FROM public.creator_render_jobs
       WHERE post_id = $1

      UNION ALL

      SELECT
        'publish_job' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'status', status,
          'attempts', attempts,
          'error', error,
          'scheduled_for', scheduled_for,
          'started_at', started_at,
          'completed_at', completed_at,
          'publisher', publisher::text
        ) AS data
        FROM public.creator_publish_jobs
       WHERE post_id = $1
    ) AS events
    ORDER BY at_ts ASC
    LIMIT 200
  `;

  const pool = (await import("../../db/client.js")).getPool();
  const r = await pool.query<{
    kind: string;
    id: string;
    at_ts: string;
    data: Record<string, unknown>;
  }>(sql, [post.id, post.chat_session_id]);

  return c.json({
    post_id: post.id,
    events: r.rows,
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function toPostApi(p: CreatorPostRow) {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    visual_style: p.visual_style,
    slides_count: p.slides_count,
    cover_image_url: p.cover_image_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function toPostDetailApi(p: CreatorPostRow) {
  return {
    ...toPostApi(p),
    slides_config: p.slides_config,
    caption: p.caption,
    first_comment: p.first_comment,
    hashtags: p.hashtags,
    research_data: p.research_data,
    brand_snapshot: p.brand_snapshot,
    rejection_feedback: p.rejection_feedback,
    revision_count: p.revision_count,
    chat_session_id: p.chat_session_id,
    scheduled_at: p.scheduled_at,
    published_at: p.published_at,
    publish_error: p.publish_error,
    external_post_url: p.external_post_url,
    external_post_id: p.external_post_id,
  };
}
