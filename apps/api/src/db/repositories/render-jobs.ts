import { many, one, oneOrThrow, type Queryable } from "../client.js";

export type RenderStatus = "pending" | "running" | "completed" | "failed";

export interface RenderJobRow {
  id: string;
  post_id: string;
  company_id: string;
  slide_indexes: number[];
  status: RenderStatus;
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

export async function createRenderJob(
  q: Queryable | undefined,
  args: {
    postId: string;
    companyId: string;
    /** Empty array = render all slides. */
    slideIndexes?: number[];
  },
): Promise<RenderJobRow> {
  return oneOrThrow<RenderJobRow>(
    q,
    `INSERT INTO public.creator_render_jobs (post_id, company_id, slide_indexes)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [args.postId, args.companyId, args.slideIndexes ?? []],
  );
}

export async function getRenderJob(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<RenderJobRow | null> {
  return one<RenderJobRow>(
    q,
    `SELECT * FROM public.creator_render_jobs WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

/** Latest render job for a post, regardless of status. */
export async function getLatestRenderJobForPost(
  q: Queryable | undefined,
  postId: string,
  companyId: string,
): Promise<RenderJobRow | null> {
  return one<RenderJobRow>(
    q,
    `SELECT * FROM public.creator_render_jobs
      WHERE post_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [postId, companyId],
  );
}

export async function listRenderJobsForPost(
  q: Queryable | undefined,
  postId: string,
  companyId: string,
): Promise<RenderJobRow[]> {
  return many<RenderJobRow>(
    q,
    `SELECT * FROM public.creator_render_jobs
      WHERE post_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [postId, companyId],
  );
}
