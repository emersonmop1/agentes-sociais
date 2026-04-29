import { many, one, oneOrThrow, type Queryable } from "../client.js";

export type YTThumbStatus = "pending" | "running" | "completed" | "failed";

export interface YouTubeThumbJobRow {
  id: string;
  project_id: string;
  company_id: string;
  concept_indexes: number[];
  status: YTThumbStatus;
  attempts: number;
  max_attempts: number;
  error: string | null;
  output_urls: string[];
  leased_at: string | null;
  leased_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export async function createThumbJob(
  q: Queryable | undefined,
  args: { projectId: string; companyId: string; conceptIndexes?: number[] },
): Promise<YouTubeThumbJobRow> {
  return oneOrThrow<YouTubeThumbJobRow>(
    q,
    `INSERT INTO public.youtube_thumbnail_jobs (project_id, company_id, concept_indexes)
     VALUES ($1, $2, $3) RETURNING *`,
    [args.projectId, args.companyId, args.conceptIndexes ?? []],
  );
}

export async function getLatestThumbJobForProject(
  q: Queryable | undefined,
  projectId: string,
  companyId: string,
): Promise<YouTubeThumbJobRow | null> {
  return one<YouTubeThumbJobRow>(
    q,
    `SELECT * FROM public.youtube_thumbnail_jobs
      WHERE project_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, companyId],
  );
}

export async function listThumbJobsForProject(
  q: Queryable | undefined,
  projectId: string,
  companyId: string,
): Promise<YouTubeThumbJobRow[]> {
  return many<YouTubeThumbJobRow>(
    q,
    `SELECT * FROM public.youtube_thumbnail_jobs
      WHERE project_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT 50`,
    [projectId, companyId],
  );
}
