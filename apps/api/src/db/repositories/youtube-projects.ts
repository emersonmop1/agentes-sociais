import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";

export type YouTubeProjectStatus =
  | "draft"
  | "transcribing"
  | "transcribed"
  | "ideation"
  | "ideation_review"
  | "generating_thumbs"
  | "thumbs_review"
  | "final_review"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "publish_failed"
  | "rejected"
  | "failed";

export interface YouTubeKeyMoment {
  timestamp_seconds: number;
  description: string;
}

export interface YouTubeChapter {
  timestamp: string; // "00:00", "01:42"
  title: string;
}

export interface YouTubeCitedVideo {
  timestamp?: string;
  title: string;
  url?: string;
  video_id?: string;
}

export interface YouTubeEndScreenVideo {
  title: string;
  reason: string;
  video_id?: string;
}

export interface YouTubeThumbnailConcept {
  index: number;
  subject: string;       // who/what is in the thumb
  hook_text: string;     // text overlay (1-3 words)
  emotion: string;       // shock | curiosity | confidence | excitement
  color_palette: string[];
  composition: string;
  image_prompt: string;  // full prompt for the image generator
  use_creator_face: boolean;
}

export interface YouTubeProjectRow {
  id: string;
  company_id: string;
  created_by: string | null;

  status: YouTubeProjectStatus;
  error: string | null;
  progress_step: string | null;
  progress_pct: number;

  drive_url: string | null;
  drive_file_id: string | null;
  storage_video_url: string | null;
  video_duration_s: number | null;
  video_size_mb: number | null;

  transcript: string | null;
  transcript_summary: string | null;
  key_moments: YouTubeKeyMoment[];

  title_options: string[];
  top_3_titles: string[];
  chosen_title: string | null;
  description: string | null;
  tags: string[];
  chapters: YouTubeChapter[];
  cited_videos: YouTubeCitedVideo[];
  end_screen_videos: YouTubeEndScreenVideo[];

  thumbnail_concepts: YouTubeThumbnailConcept[];
  thumbnail_urls: string[];
  chosen_thumbnail_idx: number | null;
  use_creator_face: boolean;
  creator_face_refs: string[];

  youtube_video_id: string | null;
  youtube_url: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  publish_error: string | null;

  pinned_comment_text: string | null;
  pinned_comment_status: string | null;
  pinned_comment_error: string | null;

  studio_status:
    | "not_requested"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | null;
  studio_error: string | null;
  studio_completed_at: string | null;

  rejection_feedback: string | null;
  revision_count: number;

  chat_session_id: string | null;

  created_at: string;
  updated_at: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function createProject(
  q: Queryable | undefined,
  args: {
    companyId: string;
    createdBy: string;
    transcript?: string;
    driveUrl?: string;
    storageVideoUrl?: string;
    useCreatorFace?: boolean;
    creatorFaceRefs?: string[];
  },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `INSERT INTO public.youtube_projects
       (company_id, created_by, transcript, drive_url, storage_video_url,
        use_creator_face, creator_face_refs)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      args.companyId,
      args.createdBy,
      args.transcript ?? null,
      args.driveUrl ?? null,
      args.storageVideoUrl ?? null,
      args.useCreatorFace ?? false,
      args.creatorFaceRefs ?? [],
    ],
  );
}

export async function getProjectById(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<YouTubeProjectRow | null> {
  return one<YouTubeProjectRow>(
    q,
    `SELECT * FROM public.youtube_projects WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

export async function listProjects(
  q: Queryable | undefined,
  args: { companyId: string; status?: YouTubeProjectStatus; limit?: number },
): Promise<YouTubeProjectRow[]> {
  const conds: string[] = [`company_id = $1`];
  const vals: unknown[] = [args.companyId];
  if (args.status) {
    conds.push(`status = $${vals.length + 1}::public.youtube_project_status`);
    vals.push(args.status);
  }
  vals.push(args.limit ?? 100);
  return many<YouTubeProjectRow>(
    q,
    `SELECT * FROM public.youtube_projects
      WHERE ${conds.join(" AND ")}
      ORDER BY updated_at DESC LIMIT $${vals.length}`,
    vals as never,
  );
}

export async function deleteProject(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.youtube_projects WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

// ─── Field updates per stage ──────────────────────────────────────────────

export async function updateTranscript(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    transcript: string;
    transcriptSummary: string | null;
    keyMoments: YouTubeKeyMoment[];
  },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET transcript = $3,
            transcript_summary = $4,
            key_moments = $5::jsonb,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [
      args.id,
      args.companyId,
      args.transcript,
      args.transcriptSummary,
      JSON.stringify(args.keyMoments),
    ],
  );
}

export async function updateIdeation(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    titleOptions: string[];
    top3Titles: string[];
    chosenTitle?: string | null;
    description: string;
    tags: string[];
    chapters: YouTubeChapter[];
    citedVideos: YouTubeCitedVideo[];
    endScreenVideos: YouTubeEndScreenVideo[];
  },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET title_options = $3,
            top_3_titles = $4,
            chosen_title = COALESCE($5, chosen_title),
            description = $6,
            tags = $7,
            chapters = $8::jsonb,
            cited_videos = $9::jsonb,
            end_screen_videos = $10::jsonb,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [
      args.id,
      args.companyId,
      args.titleOptions,
      args.top3Titles,
      args.chosenTitle ?? null,
      args.description,
      args.tags,
      JSON.stringify(args.chapters),
      JSON.stringify(args.citedVideos),
      JSON.stringify(args.endScreenVideos),
    ],
  );
}

export async function pickTitle(
  q: Queryable | undefined,
  args: { id: string; companyId: string; title: string },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET chosen_title = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.title],
  );
}

export async function updateThumbnailConcepts(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    concepts: YouTubeThumbnailConcept[];
  },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET thumbnail_concepts = $3::jsonb,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, JSON.stringify(args.concepts)],
  );
}

export async function updateThumbnailUrls(
  q: Queryable | undefined,
  args: { id: string; companyId: string; urls: string[] },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET thumbnail_urls = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.urls],
  );
}

export async function pickThumbnail(
  q: Queryable | undefined,
  args: { id: string; companyId: string; idx: number },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET chosen_thumbnail_idx = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.idx],
  );
}

export async function updateStatus(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    status: YouTubeProjectStatus;
    rejectionFeedback?: string | null;
    incrementRevision?: boolean;
    error?: string | null;
  },
): Promise<YouTubeProjectRow> {
  return oneOrThrow<YouTubeProjectRow>(
    q,
    `UPDATE public.youtube_projects
        SET status = $3::public.youtube_project_status,
            rejection_feedback = $4,
            revision_count = revision_count + $5,
            error = COALESCE($6, error),
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [
      args.id,
      args.companyId,
      args.status,
      args.rejectionFeedback ?? null,
      args.incrementRevision ? 1 : 0,
      args.error ?? null,
    ],
  );
}

// ─── Creator faces ────────────────────────────────────────────────────────

export interface CreatorFaceRow {
  id: string;
  company_id: string;
  storage_path: string;
  storage_url: string;
  label: string | null;
  created_at: string;
}

export async function listCreatorFaces(
  q: Queryable | undefined,
  companyId: string,
): Promise<CreatorFaceRow[]> {
  return many<CreatorFaceRow>(
    q,
    `SELECT * FROM public.creator_faces
      WHERE company_id = $1
      ORDER BY created_at DESC LIMIT 100`,
    [companyId],
  );
}

export async function createCreatorFace(
  q: Queryable | undefined,
  args: {
    companyId: string;
    storagePath: string;
    storageUrl: string;
    label?: string | null;
  },
): Promise<CreatorFaceRow> {
  return oneOrThrow<CreatorFaceRow>(
    q,
    `INSERT INTO public.creator_faces (company_id, storage_path, storage_url, label)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.companyId, args.storagePath, args.storageUrl, args.label ?? null],
  );
}

export async function deleteCreatorFace(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.creator_faces WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}
