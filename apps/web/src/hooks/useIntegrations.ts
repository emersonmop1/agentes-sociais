import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface InstagramStatus {
  connected: boolean;
  invalid_reason?: string | null;
  username?: string | null;
  ig_user_id?: string | null;
  fb_page_name?: string | null;
  connected_at?: string | null;
}

export interface YouTubeChannelStatus {
  connected: boolean;
  invalid_reason?: string | null;
  channel_id?: string | null;
  channel_title?: string | null;
  channel_custom_url?: string | null;
  channel_thumbnail_url?: string | null;
  connected_at?: string | null;
}

export function useIntegrationStatus() {
  return useQuery({
    queryKey: ["integrations", "status"],
    queryFn: () =>
      apiFetch<{ instagram: InstagramStatus; youtube: YouTubeChannelStatus }>(
        "/api/integrations/status",
      ),
    staleTime: 30_000,
  });
}

/**
 * Initiates the Facebook OAuth flow.
 * Returns the authorize URL the caller should open in a popup or redirect.
 */
export function useConnectInstagram() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ authorize_url: string }>("/api/integrations/instagram/connect", {
        method: "POST",
      }),
  });
}

export function useDisconnectInstagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/integrations/instagram/disconnect", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
}

// ─── Auto publish via Graph API ─────────────────────────────────────────

export interface PublishStatus {
  post_status: string;
  job: {
    id: string;
    status: "queued" | "publishing" | "completed" | "failed" | "cancelled";
    attempts: number;
    error: string | null;
    scheduled_for: string | null;
    completed_at: string | null;
  } | null;
  external_post_url: string | null;
  external_post_id: string | null;
}

export function useAutoPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      scheduledFor,
    }: {
      postId: string;
      scheduledFor?: Date;
    }) =>
      apiFetch<{ job_id: string; scheduled: boolean }>(
        `/api/insta-creator/posts/${postId}/publish`,
        {
          method: "POST",
          body: scheduledFor
            ? { scheduled_for: scheduledFor.toISOString() }
            : {},
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insta"] }),
  });
}

export function usePublishStatus(postId: string | undefined, isPublishing: boolean) {
  return useQuery({
    queryKey: ["insta", "publish-status", postId],
    queryFn: () =>
      apiFetch<PublishStatus>(`/api/insta-creator/posts/${postId}/publish-status`),
    enabled: Boolean(postId) && isPublishing,
    refetchInterval: isPublishing ? 3_000 : false,
  });
}

// ─── Google / YouTube ────────────────────────────────────────────────────

export function useConnectGoogle() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ authorize_url: string }>("/api/integrations/google/connect", {
        method: "POST",
      }),
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/integrations/google/disconnect", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
}

export function useUpdateSourceVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, url }: { projectId: string; url: string }) =>
      apiFetch(`/api/youtube/projects/${projectId}/source-video`, {
        method: "PUT",
        body: { storage_video_url: url },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useAutoPublishYT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      privacy,
      scheduledFor,
    }: {
      projectId: string;
      privacy: "private" | "unlisted" | "public";
      scheduledFor?: Date;
    }) =>
      apiFetch<{ job_id: string; scheduled: boolean }>(
        `/api/youtube/projects/${projectId}/publish`,
        {
          method: "POST",
          body: {
            privacy,
            ...(scheduledFor && { scheduled_for: scheduledFor.toISOString() }),
          },
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useManualPublishYT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      url,
      videoId,
    }: {
      projectId: string;
      url?: string;
      videoId?: string;
    }) =>
      apiFetch(`/api/youtube/projects/${projectId}/manual-publish`, {
        method: "POST",
        body: { youtube_url: url, youtube_video_id: videoId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export interface YTPublishStatus {
  project_status: string;
  job: {
    id: string;
    status: "queued" | "uploading" | "finishing" | "completed" | "failed" | "cancelled";
    attempts: number;
    error: string | null;
    scheduled_for: string | null;
    completed_at: string | null;
  } | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
}

export function useYTPublishStatus(projectId: string | undefined, isPublishing: boolean) {
  return useQuery({
    queryKey: ["youtube", "publish-status", projectId],
    queryFn: () =>
      apiFetch<YTPublishStatus>(`/api/youtube/projects/${projectId}/publish-status`),
    enabled: Boolean(projectId) && isPublishing,
    refetchInterval: isPublishing ? 3_000 : false,
  });
}

// ─── YouTube Studio (cookie-based Playwright automation) ─────────────────

export interface StudioSessionStatus {
  connected: boolean;
  invalid_reason?: string | null;
  expires_at?: string | null;
  last_validated_at?: string | null;
  connected_at?: string | null;
}

export interface StudioCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function useStudioStatus() {
  return useQuery({
    queryKey: ["integrations", "youtube-studio", "status"],
    queryFn: () =>
      apiFetch<StudioSessionStatus>("/api/integrations/youtube-studio/status"),
    staleTime: 30_000,
  });
}

export function useUploadStudioCookies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cookies: StudioCookie[]) =>
      apiFetch<{ connected: boolean; expires_at: string | null; cookie_count: number }>(
        "/api/integrations/youtube-studio/cookies",
        { method: "POST", body: { cookies } },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["integrations", "youtube-studio"] }),
  });
}

export function useDisconnectStudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/integrations/youtube-studio", { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["integrations", "youtube-studio"] }),
  });
}

export function useUpdatePinnedComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, text }: { projectId: string; text: string }) =>
      apiFetch(`/api/youtube/projects/${projectId}/pinned-comment`, {
        method: "PUT",
        body: { text },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export function useRunStudioAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      apiFetch<{ job_id: string; kind: string; status: string }>(
        `/api/youtube/projects/${projectId}/studio-automation`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["youtube"] }),
  });
}

export interface StudioStatusResponse {
  studio_status: "not_requested" | "queued" | "running" | "completed" | "failed" | null;
  studio_error: string | null;
  studio_completed_at: string | null;
  job: {
    id: string;
    kind: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    attempts: number;
    error: string | null;
    completed_at: string | null;
    result: Record<string, unknown>;
  } | null;
}

export function useStudioStatusForProject(
  projectId: string | undefined,
  isRunning: boolean,
) {
  return useQuery({
    queryKey: ["youtube", "studio-status", projectId],
    queryFn: () =>
      apiFetch<StudioStatusResponse>(
        `/api/youtube/projects/${projectId}/studio-status`,
      ),
    enabled: Boolean(projectId),
    refetchInterval: isRunning ? 3_000 : false,
  });
}
