import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type YouTubeStatus =
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

export interface YouTubeChapter {
  timestamp: string;
  title: string;
}

export interface YouTubeCitedVideo {
  title: string;
  url?: string;
}

export interface YouTubeEndScreenVideo {
  title: string;
  reason: string;
}

export interface YouTubeThumbConcept {
  index: number;
  subject: string;
  hook_text: string;
  emotion: string;
  color_palette: string[];
  composition: string;
  image_prompt: string;
  use_creator_face: boolean;
}

export interface YouTubeProjectSummary {
  id: string;
  status: YouTubeStatus;
  drive_url: string | null;
  chosen_title: string | null;
  title_options: string[];
  thumbnail_count: number;
  chosen_thumbnail_idx: number | null;
  error: string | null;
  progress_step: string | null;
  progress_pct: number;
  created_at: string;
  updated_at: string;
}

export interface YouTubeProject extends YouTubeProjectSummary {
  transcript: string | null;
  transcript_summary: string | null;
  key_moments: { timestamp_seconds: number; description: string }[];
  top_3_titles: string[];
  description: string | null;
  tags: string[];
  chapters: YouTubeChapter[];
  cited_videos: YouTubeCitedVideo[];
  end_screen_videos: YouTubeEndScreenVideo[];
  thumbnail_concepts: YouTubeThumbConcept[];
  thumbnail_urls: string[];
  use_creator_face: boolean;
  creator_face_refs: string[];
  youtube_url: string | null;
  youtube_video_id: string | null;
  pinned_comment_text: string | null;
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
}

// ─── Queries ─────────────────────────────────────────────────────────────

export function useYouTubeProjects() {
  return useQuery({
    queryKey: ["youtube", "list"],
    queryFn: () =>
      apiFetch<{ projects: YouTubeProjectSummary[] }>("/api/youtube/projects"),
    refetchInterval: 10_000,
  });
}

export function useYouTubeProject(id: string | undefined) {
  return useQuery({
    queryKey: ["youtube", "project", id],
    queryFn: () =>
      apiFetch<{ project: YouTubeProject }>(`/api/youtube/projects/${id}`),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
}

export interface ThumbStatus {
  project_status: YouTubeStatus;
  job: {
    id: string;
    status: "pending" | "running" | "completed" | "failed";
    attempts: number;
    error: string | null;
    completed_at: string | null;
  } | null;
  thumbnail_urls: string[];
  thumbnail_concepts: YouTubeThumbConcept[];
}

export function useThumbStatus(projectId: string | undefined, isGenerating: boolean) {
  return useQuery({
    queryKey: ["youtube", "thumb-status", projectId],
    queryFn: () =>
      apiFetch<ThumbStatus>(`/api/youtube/projects/${projectId}/thumb-status`),
    enabled: Boolean(projectId) && isGenerating,
    refetchInterval: isGenerating ? 3_000 : false,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      transcript?: string;
      drive_url?: string;
      use_creator_face?: boolean;
      creator_face_refs?: string[];
    }) =>
      apiFetch<{ project: YouTubeProject }>("/api/youtube/projects", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/youtube/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useUpdateTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, transcript }: { id: string; transcript: string }) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/transcript`,
        { method: "PUT", body: { transcript } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useGenerateIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/generate-ideas`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function usePickTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/pick-title`,
        { method: "POST", body: { title } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useApproveIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ project: YouTubeProject; job_id: string }>(
        `/api/youtube/projects/${id}/approve-ideas`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useRegenerateThumb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idx }: { id: string; idx: number }) =>
      apiFetch<{ job_id: string }>(
        `/api/youtube/projects/${id}/regenerate-thumb/${idx}`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function usePickThumbnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, index }: { id: string; index: number }) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/pick-thumbnail`,
        { method: "POST", body: { index } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useApproveThumbs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/approve-thumbs`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useApproveYTFinal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ project: YouTubeProject }>(
        `/api/youtube/projects/${id}/approve-final`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useRejectYT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: string }) =>
      apiFetch<{ project: YouTubeProject }>(`/api/youtube/projects/${id}/reject`, {
        method: "POST",
        body: { feedback },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

// ─── Brand faces ────────────────────────────────────────────────────────

export interface BrandFace {
  id: string;
  url: string;
  label: string | null;
}

export function useBrandFaces() {
  return useQuery({
    queryKey: ["youtube", "brand-faces"],
    queryFn: () => apiFetch<{ faces: BrandFace[] }>("/api/youtube/brand-faces"),
  });
}

export function useUploadBrandFace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dataUrl, label }: { dataUrl: string; label?: string }) =>
      apiFetch<{ face: BrandFace }>("/api/youtube/brand-faces", {
        method: "POST",
        body: { data_url: dataUrl, label },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube", "brand-faces"] }),
  });
}

export function useDeleteBrandFace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/youtube/brand-faces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube", "brand-faces"] }),
  });
}
