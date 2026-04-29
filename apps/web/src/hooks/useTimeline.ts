import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type TimelineEventKind =
  | "chat_message"
  | "agent_execution"
  | "render_job"
  | "publish_job"
  | "thumbnail_job"
  | "studio_job";

export interface TimelineEvent {
  kind: TimelineEventKind;
  id: string;
  at_ts: string;
  data: Record<string, unknown>;
}

export function useInstaPostTimeline(postId: string | undefined) {
  return useQuery({
    queryKey: ["insta", "timeline", postId],
    queryFn: () =>
      apiFetch<{ post_id: string; events: TimelineEvent[] }>(
        `/api/insta-creator/posts/${postId}/timeline`,
      ),
    enabled: Boolean(postId),
    /**
     * Refetch frequently while jobs may be in flight — the timeline IS the
     * progress indicator. Cheaper than per-job polling because one query
     * reads everything.
     */
    refetchInterval: 5_000,
  });
}

export function useYouTubeProjectTimeline(projectId: string | undefined) {
  return useQuery({
    queryKey: ["youtube", "timeline", projectId],
    queryFn: () =>
      apiFetch<{ project_id: string; events: TimelineEvent[] }>(
        `/api/youtube/projects/${projectId}/timeline`,
      ),
    enabled: Boolean(projectId),
    refetchInterval: 5_000,
  });
}
