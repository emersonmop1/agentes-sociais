import type { VisualStyle } from "@agentes/shared";
import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";

export type CreatorPostStatus =
  | "draft"
  | "copy_review"
  | "copy_approved"
  | "design_review"
  | "design_approved"
  | "caption_review"
  | "caption_approved"
  | "final_review"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "publish_failed"
  | "rejected";

export type CreatorPostType = "carousel" | "single";

/** A single slide inside slides_config (matches final.md §4.6). */
export interface SlideConfig {
  index: number;
  title: string;
  subtitle?: string;
  body?: string;
  is_cover?: boolean;
  is_cta?: boolean;
  image?: {
    search_query: string;
    source?: string;
    url?: string;
    credit?: string;
    width?: number;
    height?: number;
  } | null;
  rendered_url?: string | null;
  rendered_at?: string | null;
  background_color?: string;
  highlight_color?: string;
}

export interface CreatorPostRow {
  id: string;
  company_id: string;
  created_by: string | null;

  title: string;
  post_type: CreatorPostType;
  status: CreatorPostStatus;
  visual_style: VisualStyle;

  slides_config: SlideConfig[];
  slides_count: number;

  slides_storage_prefix: string | null;
  cover_image_url: string | null;

  caption: string | null;
  first_comment: string | null;
  hashtags: string[];

  research_data: Record<string, unknown>;
  source_urls: string[];

  brand_snapshot: Record<string, unknown>;

  rejection_feedback: string | null;
  revision_count: number;

  scheduled_at: string | null;
  published_at: string | null;
  publish_error: string | null;
  external_post_id: string | null;
  external_post_url: string | null;

  performance_data: Record<string, unknown>;
  performance_last_polled_at: string | null;

  chat_session_id: string | null;

  created_at: string;
  updated_at: string;
}

// ─── Inserts ─────────────────────────────────────────────────────────────

export interface CreatePostArgs {
  companyId: string;
  createdBy: string;
  title: string;
  visualStyle: VisualStyle;
  postType?: CreatorPostType;
  /** Cloned brand_config at creation time. */
  brandSnapshot: Record<string, unknown>;
  chatSessionId?: string;
}

export async function createPost(
  q: Queryable | undefined,
  args: CreatePostArgs,
): Promise<CreatorPostRow> {
  return oneOrThrow<CreatorPostRow>(
    q,
    `INSERT INTO public.creator_posts
       (company_id, created_by, title, visual_style, post_type,
        brand_snapshot, chat_session_id)
     VALUES ($1, $2, $3, $4::public.visual_style, $5::public.creator_post_type,
             $6::jsonb, $7)
     RETURNING *`,
    [
      args.companyId,
      args.createdBy,
      args.title,
      args.visualStyle,
      args.postType ?? "carousel",
      JSON.stringify(args.brandSnapshot),
      args.chatSessionId ?? null,
    ],
  );
}

// ─── Reads ───────────────────────────────────────────────────────────────

export async function getPostById(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<CreatorPostRow | null> {
  return one<CreatorPostRow>(
    q,
    `SELECT * FROM public.creator_posts WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

export async function listPosts(
  q: Queryable | undefined,
  args: {
    companyId: string;
    status?: CreatorPostStatus;
    limit?: number;
    /** Used by InstaCreator agent to refuse repeating topics. */
    titleHistory?: boolean;
  },
): Promise<CreatorPostRow[]> {
  const conds: string[] = [`company_id = $1`];
  const vals: unknown[] = [args.companyId];
  if (args.status) {
    conds.push(`status = $${vals.length + 1}::public.creator_post_status`);
    vals.push(args.status);
  }
  vals.push(args.limit ?? 100);
  return many<CreatorPostRow>(
    q,
    `SELECT * FROM public.creator_posts
      WHERE ${conds.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT $${vals.length}`,
    vals as never,
  );
}

/** Pull last N post titles for the InstaCreator system prompt's anti-repeat block. */
export async function listRecentTitles(
  q: Queryable | undefined,
  companyId: string,
  limit = 500,
): Promise<{ id: string; title: string; status: CreatorPostStatus; created_at: string }[]> {
  return many(
    q,
    `SELECT id, title, status, created_at
       FROM public.creator_posts
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [companyId, limit],
  );
}

// ─── Update / status transitions ─────────────────────────────────────────

/** Only updates the status field. Used by the state machine. */
export async function updatePostStatus(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    status: CreatorPostStatus;
    rejectionFeedback?: string | null;
    incrementRevision?: boolean;
  },
): Promise<CreatorPostRow> {
  return oneOrThrow<CreatorPostRow>(
    q,
    `UPDATE public.creator_posts
        SET status = $3::public.creator_post_status,
            rejection_feedback = $4,
            revision_count = revision_count + $5,
            updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [
      args.id,
      args.companyId,
      args.status,
      args.rejectionFeedback ?? null,
      args.incrementRevision ? 1 : 0,
    ],
  );
}

/** Replace slides_config + slides_count in one go. */
export async function updateSlides(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    slidesConfig: SlideConfig[];
    researchData?: Record<string, unknown>;
    sourceUrls?: string[];
  },
): Promise<CreatorPostRow> {
  return oneOrThrow<CreatorPostRow>(
    q,
    `UPDATE public.creator_posts
        SET slides_config = $3::jsonb,
            slides_count = $4,
            research_data = COALESCE($5::jsonb, research_data),
            source_urls = COALESCE($6, source_urls),
            updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [
      args.id,
      args.companyId,
      JSON.stringify(args.slidesConfig),
      args.slidesConfig.length,
      args.researchData ? JSON.stringify(args.researchData) : null,
      args.sourceUrls ?? null,
    ],
  );
}

/** Patch caption + first_comment + hashtags. */
export async function updateCaption(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    caption: string | null;
    firstComment: string | null;
    hashtags: string[];
  },
): Promise<CreatorPostRow> {
  return oneOrThrow<CreatorPostRow>(
    q,
    `UPDATE public.creator_posts
        SET caption = $3,
            first_comment = $4,
            hashtags = $5,
            updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [args.id, args.companyId, args.caption, args.firstComment, args.hashtags],
  );
}

/** Patch a single slide by index inside slides_config (jsonb_set). */
export async function patchSlide(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    index: number;
    patch: Partial<SlideConfig>;
  },
): Promise<CreatorPostRow> {
  // We do this in JS land for clarity rather than complex jsonb_set
  const post = await getPostById(q, args.id, args.companyId);
  if (!post) throw new Error(`post ${args.id} not found`);
  const slides = [...post.slides_config];
  if (args.index < 0 || args.index >= slides.length) {
    throw new Error(`slide index ${args.index} out of range`);
  }
  slides[args.index] = { ...slides[args.index]!, ...args.patch };
  return updateSlides(q, {
    id: args.id,
    companyId: args.companyId,
    slidesConfig: slides,
  });
}

export async function deletePost(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.creator_posts WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}
