import { many, one, oneOrThrow, type Queryable } from "../client.js";

export type YTPublishStatus =
  | "queued"
  | "uploading"
  | "finishing"
  | "completed"
  | "failed"
  | "cancelled";

export type YTPrivacy = "private" | "unlisted" | "public";

export interface YouTubePublishJobRow {
  id: string;
  project_id: string;
  company_id: string;
  scheduled_for: string | null;
  privacy_status: YTPrivacy;
  status: YTPublishStatus;
  attempts: number;
  max_attempts: number;
  error: string | null;
  external_response: Record<string, unknown> | null;
  leased_at: string | null;
  leased_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export async function createYouTubePublishJob(
  q: Queryable | undefined,
  args: {
    projectId: string;
    companyId: string;
    privacy: YTPrivacy;
    scheduledFor?: Date | null;
  },
): Promise<YouTubePublishJobRow> {
  return oneOrThrow<YouTubePublishJobRow>(
    q,
    `INSERT INTO public.youtube_publish_jobs
       (project_id, company_id, privacy_status, scheduled_for)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      args.projectId,
      args.companyId,
      args.privacy,
      args.scheduledFor?.toISOString() ?? null,
    ],
  );
}

export async function getLatestYouTubePublishJob(
  q: Queryable | undefined,
  projectId: string,
  companyId: string,
): Promise<YouTubePublishJobRow | null> {
  return one<YouTubePublishJobRow>(
    q,
    `SELECT * FROM public.youtube_publish_jobs
      WHERE project_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, companyId],
  );
}

export async function listYouTubePublishJobs(
  q: Queryable | undefined,
  projectId: string,
  companyId: string,
): Promise<YouTubePublishJobRow[]> {
  return many<YouTubePublishJobRow>(
    q,
    `SELECT * FROM public.youtube_publish_jobs
      WHERE project_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT 50`,
    [projectId, companyId],
  );
}
