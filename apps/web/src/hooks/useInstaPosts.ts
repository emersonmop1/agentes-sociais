import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

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

export type VisualStyleSlug = "tweet_thread" | "dark" | "acid_text" | "tweet_single";

export interface SlideConfig {
  index: number;
  title: string;
  subtitle?: string;
  body?: string;
  is_cover?: boolean;
  is_cta?: boolean;
  image?: {
    search_query?: string;
    url?: string;
    credit?: string;
    width?: number;
    height?: number;
  } | null;
  rendered_url?: string | null;
  rendered_at?: string | null;
}

export interface PostSummary {
  id: string;
  title: string;
  status: CreatorPostStatus;
  visual_style: VisualStyleSlug;
  slides_count: number;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostDetail extends PostSummary {
  slides_config: SlideConfig[];
  caption: string | null;
  first_comment: string | null;
  hashtags: string[];
  research_data: Record<string, unknown>;
  brand_snapshot: Record<string, unknown>;
  rejection_feedback: string | null;
  revision_count: number;
  chat_session_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  publish_error: string | null;
  external_post_url: string | null;
}

export interface KanbanBuckets {
  draft: PostSummary[];
  copy_review: PostSummary[];
  copy_approved: PostSummary[];
  design_review: PostSummary[];
  design_approved: PostSummary[];
  caption_review: PostSummary[];
  caption_approved: PostSummary[];
  final_review: PostSummary[];
  ready: PostSummary[];
  publishing: PostSummary[];
  published: PostSummary[];
  failed: PostSummary[];
}

// ─── Queries ─────────────────────────────────────────────────────────────

export function useKanban() {
  return useQuery({
    queryKey: ["insta", "kanban"],
    queryFn: () => apiFetch<{ buckets: KanbanBuckets }>("/api/insta-creator/kanban"),
    refetchInterval: 10_000,
  });
}

export function usePost(postId: string | undefined) {
  return useQuery({
    queryKey: ["insta", "post", postId],
    queryFn: () => apiFetch<{ post: PostDetail }>(`/api/insta-creator/posts/${postId}`),
    enabled: Boolean(postId),
    refetchInterval: 5_000,
  });
}

export interface RenderStatus {
  post_status: CreatorPostStatus;
  job: {
    id: string;
    status: "pending" | "running" | "completed" | "failed";
    attempts: number;
    error: string | null;
    slides_rendered: number;
    created_at: string;
    completed_at: string | null;
  } | null;
  slides_config: SlideConfig[];
}

/** Polls render status while a job is in flight. Stops when status terminal. */
export function useRenderStatus(postId: string | undefined, isRendering: boolean) {
  return useQuery({
    queryKey: ["insta", "render-status", postId],
    queryFn: () =>
      apiFetch<RenderStatus>(`/api/insta-creator/posts/${postId}/render-status`),
    enabled: Boolean(postId) && isRendering,
    refetchInterval: isRendering ? 2_000 : false,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────

export function useApprovePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<{ post: PostSummary }>(
        `/api/insta-creator/posts/${postId}/approve`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insta"] });
    },
  });
}

export function useRejectPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, feedback }: { postId: string; feedback: string }) =>
      apiFetch<{ post: PostSummary }>(`/api/insta-creator/posts/${postId}/reject`, {
        method: "POST",
        body: { feedback },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insta"] }),
  });
}

export function useKillPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch(`/api/insta-creator/posts/${postId}/kill`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insta"] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch(`/api/insta-creator/posts/${postId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insta"] }),
  });
}

export function useGenerateSlides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<{ job_id: string; slides_with_images: number; total_slides: number }>(
        `/api/insta-creator/posts/${postId}/generate-slides`,
        { method: "POST" },
      ),
    onSuccess: (_d, postId) => {
      qc.invalidateQueries({ queryKey: ["insta", "post", postId] });
      qc.invalidateQueries({ queryKey: ["insta", "kanban"] });
    },
  });
}

export function useRegenerateSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, idx }: { postId: string; idx: number }) =>
      apiFetch<{ job_id: string }>(
        `/api/insta-creator/posts/${postId}/regenerate-slide/${idx}`,
        { method: "POST" },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["insta", "post", vars.postId] });
    },
  });
}

export interface RegenerateImageInput {
  postId: string;
  idx: number;
  prompt?: string;
  forceGenerate?: boolean;
}

export function useRegenerateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, idx, prompt, forceGenerate }: RegenerateImageInput) =>
      apiFetch<{
        image: { url: string; credit?: string };
        job_id: string;
        used_generator: boolean;
      }>(
        `/api/insta-creator/posts/${postId}/slides/${idx}/regenerate-image`,
        {
          method: "POST",
          body: { prompt, force_generate: forceGenerate },
        },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["insta", "post", vars.postId] });
    },
  });
}

export interface CaptionResult {
  caption: string;
  first_comment: string | null;
  hashtags: string[];
}

export function useGenerateCaption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<{ post: PostDetail; caption: CaptionResult }>(
        `/api/insta-creator/posts/${postId}/caption/generate`,
        { method: "POST" },
      ),
    onSuccess: (_d, postId) => {
      qc.invalidateQueries({ queryKey: ["insta", "post", postId] });
      qc.invalidateQueries({ queryKey: ["insta", "kanban"] });
    },
  });
}

export function useUpdateCaption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      caption,
      first_comment,
      hashtags,
    }: {
      postId: string;
      caption?: string;
      first_comment?: string | null;
      hashtags?: string[];
    }) =>
      apiFetch<{ post: PostDetail }>(
        `/api/insta-creator/posts/${postId}/caption`,
        {
          method: "PATCH",
          body: { caption, first_comment, hashtags },
        },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["insta", "post", vars.postId] });
    },
  });
}

export function useSubmitFinal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<{ post: PostSummary }>(
        `/api/insta-creator/posts/${postId}/submit-final`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insta"] });
    },
  });
}

export function useManualPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      external_post_url,
      external_post_id,
    }: {
      postId: string;
      external_post_url?: string;
      external_post_id?: string;
    }) =>
      apiFetch<{ post: PostDetail }>(
        `/api/insta-creator/posts/${postId}/manual-publish`,
        { method: "POST", body: { external_post_url, external_post_id } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insta"] }),
  });
}
