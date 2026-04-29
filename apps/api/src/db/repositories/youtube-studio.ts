/**
 * YouTube Studio sessions + automation jobs repository.
 *
 * "Studio" here means: cookies the user uploads → encrypted at rest →
 * worker hydrates them into Playwright to drive youtube.com/watch UI for
 * actions the public Data API can't do (pin comment, end-screen edits).
 */

import { exec, one, oneOrThrow, type Queryable } from "../client.js";

export interface YoutubeStudioSessionRow {
  company_id: string;
  cookies_encrypted: string;
  expires_at: string | null;
  last_validated_at: string | null;
  invalid: boolean;
  invalid_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function getStudioSession(
  q: Queryable | undefined,
  companyId: string,
): Promise<YoutubeStudioSessionRow | null> {
  return one<YoutubeStudioSessionRow>(
    q,
    `SELECT * FROM public.youtube_studio_sessions WHERE company_id = $1`,
    [companyId],
  );
}

export async function upsertStudioSession(
  q: Queryable | undefined,
  args: {
    companyId: string;
    cookiesEncrypted: string;
    expiresAt?: Date | null;
  },
): Promise<YoutubeStudioSessionRow> {
  return oneOrThrow<YoutubeStudioSessionRow>(
    q,
    `INSERT INTO public.youtube_studio_sessions
       (company_id, cookies_encrypted, expires_at, invalid, invalid_reason)
     VALUES ($1, $2, $3, false, NULL)
     ON CONFLICT (company_id) DO UPDATE
       SET cookies_encrypted = EXCLUDED.cookies_encrypted,
           expires_at = EXCLUDED.expires_at,
           invalid = false,
           invalid_reason = NULL,
           last_validated_at = NULL,
           updated_at = now()
     RETURNING *`,
    [args.companyId, args.cookiesEncrypted, args.expiresAt ?? null],
  );
}

export async function deleteStudioSession(
  q: Queryable | undefined,
  companyId: string,
): Promise<void> {
  await exec(q, `DELETE FROM public.youtube_studio_sessions WHERE company_id = $1`, [
    companyId,
  ]);
}

// ─── Studio jobs ───────────────────────────────────────────────────────────

export type StudioJobKind = "pin_comment";
export type StudioJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface YoutubeStudioJobRow {
  id: string;
  company_id: string;
  project_id: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  error: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function enqueueStudioJob(
  q: Queryable | undefined,
  args: {
    companyId: string;
    projectId: string;
    kind: StudioJobKind;
    payload: Record<string, unknown>;
    scheduledFor?: Date | null;
  },
): Promise<YoutubeStudioJobRow> {
  return oneOrThrow<YoutubeStudioJobRow>(
    q,
    `INSERT INTO public.youtube_studio_jobs
       (company_id, project_id, kind, payload, scheduled_for)
     VALUES ($1, $2, $3::public.youtube_studio_job_kind, $4::jsonb, $5)
     RETURNING *`,
    [
      args.companyId,
      args.projectId,
      args.kind,
      JSON.stringify(args.payload),
      args.scheduledFor ?? null,
    ],
  );
}

export async function getLatestStudioJobForProject(
  q: Queryable | undefined,
  projectId: string,
  companyId: string,
): Promise<YoutubeStudioJobRow | null> {
  return one<YoutubeStudioJobRow>(
    q,
    `SELECT * FROM public.youtube_studio_jobs
      WHERE project_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [projectId, companyId],
  );
}
