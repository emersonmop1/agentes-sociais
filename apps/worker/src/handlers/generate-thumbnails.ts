/**
 * generate-thumbnails handler — leases a youtube_thumbnail_jobs row, runs
 * Gemini Image per concept (parallel, capped), uploads PNGs, updates the
 * project's thumbnail_urls, and transitions to thumbs_review.
 */

import { getPool } from "../db.js";
import { logger } from "../lib/logger.js";
import { generateThumbnail } from "../services/youtube-thumb-generator.js";

interface ThumbJobRow {
  id: string;
  project_id: string;
  company_id: string;
  concept_indexes: number[];
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  error: string | null;
  output_urls: string[];
}

interface ProjectRow {
  id: string;
  company_id: string;
  status: string;
  thumbnail_concepts: Array<{
    index: number;
    image_prompt: string;
    use_creator_face: boolean;
  }>;
  thumbnail_urls: string[];
  use_creator_face: boolean;
  creator_face_refs: string[];
}

const PARALLEL = 3;

export async function handleGenerateThumbnailsJob(job: ThumbJobRow): Promise<void> {
  const pool = getPool();
  const startedAt = Date.now();

  const projectR = await pool.query<ProjectRow>(
    `SELECT id, company_id, status, thumbnail_concepts, thumbnail_urls,
            use_creator_face, creator_face_refs
       FROM public.youtube_projects WHERE id = $1`,
    [job.project_id],
  );
  const project = projectR.rows[0];
  if (!project) {
    await failJob(job.id, "project_not_found", false);
    return;
  }

  const concepts = project.thumbnail_concepts ?? [];
  const targetIdx =
    job.concept_indexes.length === 0
      ? concepts.map((c) => c.index)
      : job.concept_indexes;
  if (concepts.length === 0 || targetIdx.length === 0) {
    await failJob(job.id, "no_concepts_to_render", false);
    return;
  }

  // Fan-out with bounded parallelism
  const results = new Map<number, string>();
  const queue = [...targetIdx];
  const workers = Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    while (queue.length) {
      const i = queue.shift();
      if (i === undefined) break;
      const concept = concepts.find((c) => c.index === i);
      if (!concept) {
        logger.warn({ projectId: project.id, i }, "concept not found");
        continue;
      }
      try {
        const useFace = concept.use_creator_face && project.use_creator_face;
        const path = `${project.company_id}/${project.id}/thumb_${String(i).padStart(2, "0")}_${Date.now()}`;
        const out = await generateThumbnail({
          prompt: concept.image_prompt,
          creatorFaceUrls: useFace ? project.creator_face_refs : undefined,
          storagePath: path,
        });
        results.set(i, out.url);
        logger.info({ projectId: project.id, i, url: out.url }, "thumb generated");
      } catch (err) {
        logger.error(
          { projectId: project.id, i, err: (err as Error).message },
          "thumb gen failed for concept",
        );
      }
    }
  });
  await Promise.all(workers);

  if (results.size === 0) {
    await failJob(job.id, "all thumb concepts failed", true);
    return;
  }

  // Merge into existing thumbnail_urls (fill or replace by index)
  const finalUrls: string[] = Array.from(
    { length: Math.max(project.thumbnail_urls.length, ...targetIdx, 0) + 1 },
    (_, i) =>
      results.has(i)
        ? results.get(i)!
        : project.thumbnail_urls[i] ?? "",
  ).filter((u, i) => u !== "" || results.has(i) || project.thumbnail_urls[i]);

  await pool.query(
    `UPDATE public.youtube_projects
        SET thumbnail_urls = $2,
            updated_at = now()
      WHERE id = $1`,
    [project.id, finalUrls],
  );

  // If we just finished generating from generating_thumbs, advance to thumbs_review
  if (project.status === "generating_thumbs") {
    await pool.query(
      `UPDATE public.youtube_projects
          SET status = 'thumbs_review'::public.youtube_project_status,
              updated_at = now()
        WHERE id = $1`,
      [project.id],
    );
  }

  await pool.query(
    `UPDATE public.youtube_thumbnail_jobs
        SET status = 'completed'::public.youtube_thumb_job_status,
            output_urls = $2,
            completed_at = now()
      WHERE id = $1`,
    [job.id, Array.from(results.values())],
  );

  logger.info(
    {
      jobId: job.id,
      projectId: project.id,
      generated: results.size,
      latencyMs: Date.now() - startedAt,
    },
    "generate-thumbnails: job done",
  );
}

async function failJob(jobId: string, reason: string, retryable: boolean): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE public.youtube_thumbnail_jobs
        SET status = CASE
              WHEN attempts >= max_attempts OR NOT $3 THEN 'failed'::public.youtube_thumb_job_status
              ELSE 'pending'::public.youtube_thumb_job_status
            END,
            error = $2,
            leased_at = NULL,
            leased_by = NULL
      WHERE id = $1`,
    [jobId, reason.slice(0, 1000), retryable],
  );
}
