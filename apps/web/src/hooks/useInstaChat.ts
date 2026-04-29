import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { VisualStyleSlug, PostSummary } from "./useInstaPosts";

export interface InstaChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface InstaChatResponse {
  session_id: string;
  assistant: {
    id: string;
    role: "assistant";
    content: string;
    raw_content: string;
    model: string;
    tokens: { input?: number; output?: number };
  };
  post: PostSummary | null;
  memories_used: number;
}

export function useInstaSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      message: string;
      session_id?: string;
      visual_style?: VisualStyleSlug;
      user_instructions?: string;
    }) =>
      apiFetch<InstaChatResponse>(`/api/insta-creator/chat`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insta", "kanban"] });
    },
  });
}

/** Reuse the agent sessions endpoint to load a single session's messages. */
export function useInstaSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["insta", "session", sessionId],
    queryFn: () =>
      apiFetch<{
        session: { id: string; agent_slug: string; title: string | null };
        messages: InstaChatMessage[];
      }>(`/api/agents/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
  });
}
