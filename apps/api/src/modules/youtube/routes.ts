/**
 * YouTube routes — `/api/youtube/*`.
 *
 * v1 capabilities:
 *   • Create project with pasted transcript (DRAFT → TRANSCRIBED, no auto-transcribe yet)
 *   • Generate ideation (titles + chapters + tags + description + cited + end-screen)
 *   • Pick title
 *   • Generate 4 thumb concepts + enqueue thumbnail-render job
 *   • Pick a thumbnail
 *   • Approve final → READY
 *   • Brand faces upload + listing
 *
 * Out of scope this round (Fatia 8 / 7+):
 *   • Drive download, automatic transcription via Gemini multimodal
 *   • YouTube Data API upload + Studio Automation (A/B title, end screen, pinned)
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  runIdeation,
  runThumbStrategist,
} from "../../agents/youtube-growth/handler.js";
import { applyTransition } from "../../core/youtube-state-machine.js";
import { tx } from "../../db/client.js";
import { createClient } from "@supabase/supabase-js";
import { recordExecution } from "../../db/repositories/executions.js";
import {
  createCreatorFace,
  createProject,
  deleteCreatorFace,
  deleteProject,
  getProjectById,
  listCreatorFaces,
  listProjects,
  pickThumbnail,
  pickTitle,
  updateIdeation,
  updateThumbnailConcepts,
  updateThumbnailUrls,
  updateTranscript,
  type YouTubeProjectRow,
} from "../../db/repositories/youtube-projects.js";
import {
  createThumbJob,
  getLatestThumbJobForProject,
} from "../../db/repositories/youtube-thumb-jobs.js";
import {
  createYouTubePublishJob,
  getLatestYouTubePublishJob,
  type YTPrivacy,
} from "../../db/repositories/youtube-publish-jobs.js";
import { getToken } from "../../db/repositories/integrations.js";
import { getBrandConfig } from "../../db/repositories/brand.js";
import { loadEnv } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { consumeQuota } from "../../services/quota.js";
import {
  enqueueStudioJob,
  getLatestStudioJobForProject,
  getStudioSession,
} from "../../db/repositories/youtube-studio.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const youtubeRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── POST /api/youtube/projects ─────────────────────────────────────────────
const createProjectSchema = z.object({
  /** Paste full transcript text. Skips the transcribing stage. */
  transcript: z.string().min(50).max(200_000).optional(),
  /** Optional source URL (Drive or YouTube — saved as metadata, not fetched). */
  drive_url: z.string().url().optional(),
  /** When true, the thumbnail strategist will use creator faces from the library. */
  use_creator_face: z.boolean().optional(),
  /** Storage URLs of creator faces to use for THIS project. */
  creator_face_refs: z.array(z.string().url()).max(8).optional(),
});

youtubeRoutes.post("/projects", async (c) => {
  const body = createProjectSchema.parse(await c.req.json());
  const companyId = c.var.company.companyId;

  // Quota: each new project consumes 1 youtube slot
  const q = await consumeQuota(undefined, companyId, "youtube");
  if (!q.ok) return c.json(q.json, 429);

  const project = await createProject(undefined, {
    companyId,
    createdBy: c.var.auth.userId,
    transcript: body.transcript,
    driveUrl: body.drive_url,
    useCreatorFace: body.use_creator_face,
    creatorFaceRefs: body.creator_face_refs,
  });

  // If transcript was pasted, jump status straight to "transcribed"
  let row = project;
  if (body.transcript) {
    const t = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: project.status,
      event: "start_transcribing",
    });
    const t2 = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: t.row.status,
      event: "transcribed",
    });
    row = t2.row;
  }

  return c.json({ project: toProjectApi(row) });
});

// ─── GET /api/youtube/projects ─────────────────────────────────────────────
youtubeRoutes.get("/projects", async (c) => {
  const rows = await listProjects(undefined, { companyId: c.var.company.companyId });
  return c.json({ projects: rows.map(toProjectSummaryApi) });
});

// ─── GET /api/youtube/projects/:id ─────────────────────────────────────────
youtubeRoutes.get("/projects/:id", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ project: toProjectApi(project) });
});

// ─── DELETE /api/youtube/projects/:id ──────────────────────────────────────
youtubeRoutes.delete("/projects/:id", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  await deleteProject(undefined, project.id, project.company_id);
  return c.json({ ok: true });
});

// ─── PUT /api/youtube/projects/:id/transcript ── manual paste ─────────────
const transcriptSchema = z.object({
  transcript: z.string().min(50).max(200_000),
  summary: z.string().max(2000).optional(),
});

youtubeRoutes.put("/projects/:id/transcript", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = transcriptSchema.parse(await c.req.json());
  const updated = await updateTranscript(undefined, {
    id: project.id,
    companyId: project.company_id,
    transcript: body.transcript,
    transcriptSummary: body.summary ?? null,
    keyMoments: project.key_moments,
  });
  // If still in draft, advance to transcribed
  if (updated.status === "draft") {
    await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: "draft",
      event: "start_transcribing",
    });
    const r = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: "transcribing",
      event: "transcribed",
    });
    return c.json({ project: toProjectApi(r.row) });
  }
  return c.json({ project: toProjectApi(updated) });
});

// ─── POST /api/youtube/projects/:id/generate-ideas ─────────────────────────
youtubeRoutes.post("/projects/:id/generate-ideas", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (project.status !== "transcribed") {
    return c.json({ error: "invalid_state", current: project.status }, 409);
  }

  const startedAt = Date.now();

  // Move status into "ideation" while we run
  await applyTransition({
    projectId: project.id,
    companyId: project.company_id,
    current: project.status,
    event: "start_ideation",
  });

  let ideation;
  try {
    ideation = await runIdeation({ companyId: project.company_id, project });
  } catch (err) {
    logger.error({ err: (err as Error).message, projectId: project.id }, "ideation failed");
    return c.json({ error: "ideation_failed", message: (err as Error).message }, 500);
  }

  const updated = await tx(async (client) => {
    const u = await updateIdeation(client, {
      id: project.id,
      companyId: project.company_id,
      titleOptions: ideation.title_options,
      top3Titles: ideation.top_3_titles,
      description: ideation.description,
      tags: ideation.tags,
      chapters: ideation.chapters,
      citedVideos: ideation.cited_videos,
      endScreenVideos: ideation.end_screen_videos,
    });
    const t = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: u.status,
      event: "submit_ideation",
      client,
    });
    return t.row;
  });

  void recordExecution(undefined, {
    companyId: project.company_id,
    agentSlug: "youtube-growth",
    sessionId: project.chat_session_id,
    trigger: "pipeline_step",
    provider: "gemini",
    model: ideation.model,
    tokensInput: ideation.tokens.input,
    tokensOutput: ideation.tokens.output,
    latencyMs: Date.now() - startedAt,
    metadata: { stage: "ideation" },
  });

  return c.json({ project: toProjectApi(updated) });
});

// ─── POST /api/youtube/projects/:id/pick-title ──────────────────────────────
const pickTitleSchema = z.object({
  title: z.string().min(1).max(150),
});

youtubeRoutes.post("/projects/:id/pick-title", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = pickTitleSchema.parse(await c.req.json());
  const updated = await pickTitle(undefined, {
    id: project.id,
    companyId: project.company_id,
    title: body.title,
  });
  return c.json({ project: toProjectApi(updated) });
});

// ─── POST /api/youtube/projects/:id/approve-ideas ──────────────────────────
youtubeRoutes.post("/projects/:id/approve-ideas", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (project.status !== "ideation_review") {
    return c.json({ error: "invalid_state", current: project.status }, 409);
  }
  if (!project.chosen_title) {
    return c.json({ error: "no_title", message: "pick a title first" }, 400);
  }

  // Run thumb strategist immediately, then enqueue render job
  const startedAt = Date.now();
  const brand = await getBrandConfig(undefined, project.company_id);
  let thumbs;
  try {
    thumbs = await runThumbStrategist({
      companyId: project.company_id,
      project,
      primaryColor: brand?.primary_color,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, projectId: project.id }, "thumb strategist failed");
    return c.json({ error: "thumb_strategist_failed", message: (err as Error).message }, 500);
  }

  const updated = await tx(async (client) => {
    const t1 = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: project.status,
      event: "approve_ideation",
      client,
    });
    const u = await updateThumbnailConcepts(client, {
      id: project.id,
      companyId: project.company_id,
      concepts: thumbs.concepts,
    });
    return u;
  });

  // Enqueue worker job to render the actual PNGs
  const job = await createThumbJob(undefined, {
    projectId: project.id,
    companyId: project.company_id,
  });

  void recordExecution(undefined, {
    companyId: project.company_id,
    agentSlug: "youtube-growth",
    sessionId: project.chat_session_id,
    trigger: "pipeline_step",
    provider: "gemini",
    model: thumbs.model,
    tokensInput: thumbs.tokens.input,
    tokensOutput: thumbs.tokens.output,
    latencyMs: Date.now() - startedAt,
    metadata: { stage: "thumb_concepts", concepts_count: thumbs.concepts.length },
  });

  return c.json({
    project: toProjectApi(updated),
    job_id: job.id,
    concepts_count: thumbs.concepts.length,
  });
});

// ─── GET /api/youtube/projects/:id/thumb-status ────────────────────────────
youtubeRoutes.get("/projects/:id/thumb-status", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectById(undefined, projectId, c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const job = await getLatestThumbJobForProject(undefined, projectId, c.var.company.companyId);
  return c.json({
    project_status: project.status,
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          error: job.error,
          completed_at: job.completed_at,
        }
      : null,
    thumbnail_urls: project.thumbnail_urls,
    thumbnail_concepts: project.thumbnail_concepts,
  });
});

// ─── POST /api/youtube/projects/:id/regenerate-thumb/:idx ──────────────────
youtubeRoutes.post("/projects/:id/regenerate-thumb/:idx", async (c) => {
  const projectId = c.req.param("id");
  const idx = Number.parseInt(c.req.param("idx"), 10);
  if (!Number.isInteger(idx) || idx < 0) return c.json({ error: "bad_index" }, 400);
  const project = await getProjectById(undefined, projectId, c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (idx >= project.thumbnail_concepts.length) return c.json({ error: "bad_index" }, 400);

  const job = await createThumbJob(undefined, {
    projectId,
    companyId: c.var.company.companyId,
    conceptIndexes: [idx],
  });
  return c.json({ job_id: job.id });
});

// ─── POST /api/youtube/projects/:id/pick-thumbnail ─────────────────────────
const pickThumbSchema = z.object({
  index: z.number().int().nonnegative(),
});

youtubeRoutes.post("/projects/:id/pick-thumbnail", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = pickThumbSchema.parse(await c.req.json());
  if (body.index >= project.thumbnail_urls.length) {
    return c.json({ error: "bad_index" }, 400);
  }
  const updated = await pickThumbnail(undefined, {
    id: project.id,
    companyId: project.company_id,
    idx: body.index,
  });
  return c.json({ project: toProjectApi(updated) });
});

// ─── POST /api/youtube/projects/:id/approve-thumbs ─────────────────────────
youtubeRoutes.post("/projects/:id/approve-thumbs", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (project.status !== "thumbs_review") {
    return c.json({ error: "invalid_state", current: project.status }, 409);
  }
  if (project.chosen_thumbnail_idx === null) {
    return c.json({ error: "no_thumbnail_picked" }, 400);
  }
  const t = await applyTransition({
    projectId: project.id,
    companyId: project.company_id,
    current: project.status,
    event: "approve_thumbs",
  });
  return c.json({ project: toProjectApi(t.row) });
});

// ─── POST /api/youtube/projects/:id/approve-final ──────────────────────────
youtubeRoutes.post("/projects/:id/approve-final", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (project.status !== "final_review") {
    return c.json({ error: "invalid_state", current: project.status }, 409);
  }
  const t = await applyTransition({
    projectId: project.id,
    companyId: project.company_id,
    current: project.status,
    event: "approve_final",
  });
  return c.json({ project: toProjectApi(t.row) });
});

// ─── POST /api/youtube/projects/:id/reject ─────────────────────────────────
const rejectSchema = z.object({ feedback: z.string().min(1).max(2000) });

youtubeRoutes.post("/projects/:id/reject", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = rejectSchema.parse(await c.req.json());
  try {
    const t = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: project.status,
      event: "reject",
      rejectionFeedback: body.feedback,
    });
    return c.json({ project: toProjectApi(t.row) });
  } catch (err) {
    return c.json({ error: "invalid_transition", message: (err as Error).message }, 409);
  }
});

// ─── Brand faces ────────────────────────────────────────────────────────────
youtubeRoutes.get("/brand-faces", async (c) => {
  const rows = await listCreatorFaces(undefined, c.var.company.companyId);
  return c.json({
    faces: rows.map((r) => ({
      id: r.id,
      url: r.storage_url,
      label: r.label,
      created_at: r.created_at,
    })),
  });
});

const uploadFaceSchema = z.object({
  /** Base64-encoded image bytes (data URL or raw) */
  data_url: z.string(),
  label: z.string().max(80).optional(),
});

youtubeRoutes.post("/brand-faces", async (c) => {
  const body = uploadFaceSchema.parse(await c.req.json());
  const env = loadEnv();

  // Strip data URL prefix if present
  const m = body.data_url.match(/^data:(image\/\w+);base64,(.+)$/);
  const mime = m?.[1] ?? "image/png";
  const base64 = m?.[2] ?? body.data_url;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    return c.json({ error: "invalid_image", message: "size 0 or > 8MB" }, 400);
  }
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : "bin";
  const path = `${c.var.company.companyId}/${randomUUID()}.${ext}`;

  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: upErr } = await supa.storage.from("creator-faces").upload(path, bytes, {
    contentType: mime,
    cacheControl: "604800",
    upsert: false,
  });
  if (upErr) return c.json({ error: "upload_failed", message: upErr.message }, 500);

  // creator-faces bucket is private — generate a signed URL valid for 1 year.
  const { data: signed, error: signErr } = await supa.storage
    .from("creator-faces")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed) {
    return c.json({ error: "sign_failed", message: signErr?.message ?? "" }, 500);
  }

  const row = await createCreatorFace(undefined, {
    companyId: c.var.company.companyId,
    storagePath: path,
    storageUrl: signed.signedUrl,
    label: body.label ?? null,
  });
  return c.json({ face: { id: row.id, url: row.storage_url, label: row.label } });
});

youtubeRoutes.delete("/brand-faces/:id", async (c) => {
  await deleteCreatorFace(undefined, c.req.param("id"), c.var.company.companyId);
  return c.json({ ok: true });
});

// ─── PUT /api/youtube/projects/:id/source-video ── attach source URL ─────────
// Used by the auto-publish flow to know where to fetch the actual video file.
// Accepts any publicly fetchable URL (Storage, Drive shared, signed URL).
const sourceVideoSchema = z.object({
  storage_video_url: z.string().url(),
});
youtubeRoutes.put("/projects/:id/source-video", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = sourceVideoSchema.parse(await c.req.json());
  const { exec } = await import("../../db/client.js");
  await exec(
    undefined,
    `UPDATE public.youtube_projects
        SET storage_video_url = $2, updated_at = now()
      WHERE id = $1 AND company_id = $3`,
    [project.id, body.storage_video_url, project.company_id],
  );
  const fresh = await getProjectById(undefined, project.id, project.company_id);
  return c.json({ project: toProjectApi(fresh!) });
});

// ─── POST /api/youtube/projects/:id/publish ── auto via Data API ────────────
// Pre-conditions: status === ready (or publish_failed for retry), Google
// integration connected, storage_video_url present.
const autoPublishSchema = z.object({
  privacy: z.enum(["private", "unlisted", "public"]).default("private"),
  scheduled_for: z.string().datetime().optional(),
});

youtubeRoutes.post("/projects/:id/publish", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (!["ready", "publish_failed"].includes(project.status)) {
    return c.json(
      { error: "invalid_state", message: "must be ready", current: project.status },
      409,
    );
  }
  if (!project.chosen_title) {
    return c.json({ error: "no_title", message: "pick a title first" }, 400);
  }
  if (!project.storage_video_url) {
    return c.json(
      { error: "no_video", message: "attach a source video URL first (PUT /source-video)" },
      400,
    );
  }
  const yt = await getToken(undefined, c.var.company.companyId, "youtube");
  if (!yt || yt.invalid) {
    return c.json(
      {
        error: "youtube_not_connected",
        message: yt?.invalid_reason ?? "Conecte o YouTube em Integrações antes de publicar.",
      },
      400,
    );
  }

  const body = autoPublishSchema.parse(await c.req.json().catch(() => ({})));
  const scheduledFor = body.scheduled_for ? new Date(body.scheduled_for) : null;

  const updated = await tx(async (client) => {
    const job = await createYouTubePublishJob(client, {
      projectId: project.id,
      companyId: project.company_id,
      privacy: body.privacy as YTPrivacy,
      scheduledFor,
    });
    const targetStatus = scheduledFor && scheduledFor.getTime() > Date.now() ? "scheduled" : "publishing";
    const targetEvent = targetStatus === "scheduled" ? "schedule" : "publish_now";
    const t = await applyTransition({
      projectId: project.id,
      companyId: project.company_id,
      current: project.status,
      event: targetEvent,
      client,
    });
    if (scheduledFor) {
      await client.query(
        `UPDATE public.youtube_projects SET scheduled_at = $2 WHERE id = $1`,
        [project.id, scheduledFor.toISOString()],
      );
    }
    return { project: t.row, job };
  });

  return c.json({
    project: toProjectApi(updated.project),
    job_id: updated.job.id,
    scheduled: Boolean(scheduledFor),
  });
});

// ─── GET /api/youtube/projects/:id/publish-status ───────────────────────────
youtubeRoutes.get("/projects/:id/publish-status", async (c) => {
  const projectId = c.req.param("id");
  const project = await getProjectById(undefined, projectId, c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const job = await getLatestYouTubePublishJob(undefined, projectId, c.var.company.companyId);
  return c.json({
    project_status: project.status,
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
    youtube_url: project.youtube_url,
    youtube_video_id: project.youtube_video_id,
  });
});

// ─── POST /api/youtube/projects/:id/manual-publish ──────────────────────────
// User uploaded the video themselves via Studio. Mark project as published
// with the YouTube URL/ID. Identical mental model to the Insta manual flow.
const manualPublishSchema = z.object({
  youtube_url: z.string().url().optional(),
  youtube_video_id: z.string().max(80).optional(),
});

youtubeRoutes.post("/projects/:id/manual-publish", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (!["ready", "scheduled", "publish_failed"].includes(project.status)) {
    return c.json(
      { error: "invalid_state", message: "project must be ready or scheduled", current: project.status },
      409,
    );
  }
  const body = manualPublishSchema.parse(await c.req.json());

  // Try to extract video_id from URL if URL given but ID not
  const idFromUrl =
    body.youtube_video_id ??
    (body.youtube_url ? extractYoutubeId(body.youtube_url) ?? null : null);

  const updated = await tx(async (client) => {
    await client.query(
      `UPDATE public.youtube_projects
          SET status = 'published'::public.youtube_project_status,
              published_at = now(),
              youtube_url = COALESCE($2, youtube_url),
              youtube_video_id = COALESCE($3, youtube_video_id),
              publish_error = NULL,
              updated_at = now()
        WHERE id = $1 AND company_id = $4`,
      [
        project.id,
        body.youtube_url ?? null,
        idFromUrl,
        project.company_id,
      ],
    );
    const r = await client.query(
      `SELECT * FROM public.youtube_projects WHERE id = $1`,
      [project.id],
    );
    return r.rows[0] as YouTubeProjectRow;
  });
  return c.json({ project: toProjectApi(updated) });
});

// ─── PUT /api/youtube/projects/:id/pinned-comment ───────────────────────────
const pinnedCommentSchema = z.object({
  text: z.string().min(1).max(10_000),
});
youtubeRoutes.put("/projects/:id/pinned-comment", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = pinnedCommentSchema.parse(await c.req.json());
  await tx(async (client) => {
    await client.query(
      `UPDATE public.youtube_projects
          SET pinned_comment_text = $2, updated_at = now()
        WHERE id = $1 AND company_id = $3`,
      [project.id, body.text, project.company_id],
    );
  });
  const fresh = await getProjectById(undefined, project.id, project.company_id);
  return c.json({ project: fresh ? toProjectApi(fresh) : null });
});

// ─── POST /api/youtube/projects/:id/studio-automation ────────────────────────
//
// Enqueues a Studio Playwright job for the published project. v1 only kind:
// "pin_comment" — drops the configured pinned_comment_text under the published
// video and pins it. Requires the company to have uploaded studio cookies first
// (POST /api/integrations/youtube-studio/cookies).
youtubeRoutes.post("/projects/:id/studio-automation", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  if (project.status !== "published" || !project.youtube_video_id) {
    return c.json(
      {
        error: "invalid_state",
        message: "studio automation runs only on published projects with a video id",
        current: project.status,
      },
      409,
    );
  }
  if (!project.pinned_comment_text || project.pinned_comment_text.trim().length === 0) {
    return c.json(
      {
        error: "no_comment",
        message: "set pinned_comment_text first via PUT /pinned-comment",
      },
      400,
    );
  }

  // Make sure the company has Studio cookies before queuing — fail fast.
  const session = await getStudioSession(undefined, project.company_id);
  if (!session) {
    return c.json(
      {
        error: "studio_not_connected",
        message:
          "no Studio cookies on file. Connect via POST /api/integrations/youtube-studio/cookies",
      },
      400,
    );
  }
  if (session.invalid) {
    return c.json(
      {
        error: "studio_session_invalid",
        message: session.invalid_reason ?? "reconnect Studio cookies",
      },
      400,
    );
  }

  const job = await tx(async (client) => {
    // Idempotency: cancel any prior queued/running job for this project before
    // enqueueing a fresh one. Avoids drift if the user clicks twice.
    await client.query(
      `UPDATE public.youtube_studio_jobs
          SET status = 'cancelled'::public.youtube_studio_job_status,
              updated_at = now()
        WHERE project_id = $1
          AND company_id = $2
          AND status IN ('queued', 'running')`,
      [project.id, project.company_id],
    );

    const enqueued = await enqueueStudioJob(client, {
      companyId: project.company_id,
      projectId: project.id,
      kind: "pin_comment",
      payload: {
        video_id: project.youtube_video_id,
        comment: project.pinned_comment_text,
      },
    });

    await client.query(
      `UPDATE public.youtube_projects
          SET studio_status = 'queued',
              studio_error = NULL,
              studio_completed_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [project.id],
    );

    return enqueued;
  });

  logger.info(
    { projectId: project.id, jobId: job.id, kind: job.kind },
    "studio-automation: enqueued",
  );

  return c.json({ job_id: job.id, kind: job.kind, status: job.status });
});

// ─── GET /api/youtube/projects/:id/studio-status ─────────────────────────────
youtubeRoutes.get("/projects/:id/studio-status", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const job = await getLatestStudioJobForProject(
    undefined,
    project.id,
    project.company_id,
  );
  return c.json({
    studio_status: project.studio_status,
    studio_error: project.studio_error,
    studio_completed_at: project.studio_completed_at,
    job: job
      ? {
          id: job.id,
          kind: job.kind,
          status: job.status,
          attempts: job.attempts,
          error: job.error,
          completed_at: job.completed_at,
          result: job.result,
        }
      : null,
  });
});

function extractYoutubeId(url: string): string | null {
  // Handles youtu.be/ID, youtube.com/watch?v=ID, youtube.com/shorts/ID
  const m =
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ??
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ??
    url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

// ─── GET /api/youtube/projects/:id/timeline ──────────────────────────────────
//
// Cross-table audit feed for a YouTube project. Aggregates:
//   • chat_messages          (user prompts + agent replies)
//   • agent_executions       (LLM calls)
//   • youtube_thumbnail_jobs (Gemini Image generation per thumb)
//   • youtube_publish_jobs   (Data API resumable upload)
//   • youtube_studio_jobs    (Playwright pin-comment runs)
//
// Same single-roundtrip UNION ALL approach as the insta-creator timeline.
youtubeRoutes.get("/projects/:id/timeline", async (c) => {
  const project = await getProjectById(undefined, c.req.param("id"), c.var.company.companyId);
  if (!project) return c.json({ error: "not_found" }, 404);

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
        'thumbnail_job' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'status', status::text,
          'attempts', attempts,
          'error', error,
          'started_at', started_at,
          'completed_at', completed_at
        ) AS data
        FROM public.youtube_thumbnail_jobs
       WHERE project_id = $1

      UNION ALL

      SELECT
        'publish_job' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'status', status::text,
          'attempts', attempts,
          'error', error,
          'scheduled_for', scheduled_for,
          'completed_at', completed_at
        ) AS data
        FROM public.youtube_publish_jobs
       WHERE project_id = $1

      UNION ALL

      SELECT
        'studio_job' AS kind,
        id::text AS id,
        created_at AS at_ts,
        jsonb_build_object(
          'kind', kind::text,
          'status', status::text,
          'attempts', attempts,
          'error', error,
          'completed_at', completed_at
        ) AS data
        FROM public.youtube_studio_jobs
       WHERE project_id = $1
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
  }>(sql, [project.id, project.chat_session_id]);

  return c.json({
    project_id: project.id,
    events: r.rows,
  });
});

// ─── API shapers ───────────────────────────────────────────────────────────
function toProjectSummaryApi(p: YouTubeProjectRow) {
  return {
    id: p.id,
    status: p.status,
    drive_url: p.drive_url,
    chosen_title: p.chosen_title,
    title_options: p.title_options,
    thumbnail_count: p.thumbnail_urls.length,
    chosen_thumbnail_idx: p.chosen_thumbnail_idx,
    error: p.error,
    progress_step: p.progress_step,
    progress_pct: p.progress_pct,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function toProjectApi(p: YouTubeProjectRow) {
  return {
    ...toProjectSummaryApi(p),
    transcript: p.transcript,
    transcript_summary: p.transcript_summary,
    key_moments: p.key_moments,
    top_3_titles: p.top_3_titles,
    description: p.description,
    tags: p.tags,
    chapters: p.chapters,
    cited_videos: p.cited_videos,
    end_screen_videos: p.end_screen_videos,
    thumbnail_concepts: p.thumbnail_concepts,
    thumbnail_urls: p.thumbnail_urls,
    use_creator_face: p.use_creator_face,
    creator_face_refs: p.creator_face_refs,
    youtube_url: p.youtube_url,
    youtube_video_id: p.youtube_video_id,
    pinned_comment_text: p.pinned_comment_text,
    studio_status: p.studio_status,
    studio_error: p.studio_error,
    studio_completed_at: p.studio_completed_at,
    rejection_feedback: p.rejection_feedback,
    revision_count: p.revision_count,
  };
}
