import { many, one, oneOrThrow, type Queryable } from "../client.js";

export type PublishStatus =
  | "queued"
  | "validating"
  | "uploading"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export type Publisher = "graph_api";

export interface PublishJobRow {
  id: string;
  post_id: string;
  company_id: string;
  publisher: Publisher;
  scheduled_for: string | null;
  status: PublishStatus;
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

export async function createPublishJob(
  q: Queryable | undefined,
  args: {
    postId: string;
    companyId: string;
    publisher?: Publisher;
    scheduledFor?: Date | null;
  },
): Promise<PublishJobRow> {
  return oneOrThrow<PublishJobRow>(
    q,
    `INSERT INTO public.creator_publish_jobs
       (post_id, company_id, publisher, scheduled_for)
     VALUES ($1, $2, $3::public.creator_publisher, $4)
     RETURNING *`,
    [
      args.postId,
      args.companyId,
      args.publisher ?? "graph_api",
      args.scheduledFor?.toISOString() ?? null,
    ],
  );
}

export async function getLatestPublishJobForPost(
  q: Queryable | undefined,
  postId: string,
  companyId: string,
): Promise<PublishJobRow | null> {
  return one<PublishJobRow>(
    q,
    `SELECT * FROM public.creator_publish_jobs
      WHERE post_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [postId, companyId],
  );
}

export async function listPublishJobs(
  q: Queryable | undefined,
  postId: string,
  companyId: string,
): Promise<PublishJobRow[]> {
  return many<PublishJobRow>(
    q,
    `SELECT * FROM public.creator_publish_jobs
      WHERE post_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT 50`,
    [postId, companyId],
  );
}
