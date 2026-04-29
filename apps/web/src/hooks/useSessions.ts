import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface SessionSummary {
  id: string;
  title: string | null;
  session_type: string;
  created_at: string;
  updated_at: string;
}

export function useSessions(agentSlug: string) {
  return useQuery({
    queryKey: ["sessions", agentSlug],
    queryFn: () =>
      apiFetch<{ sessions: SessionSummary[] }>(`/api/agents/${agentSlug}/sessions`),
  });
}

export function useDeleteSession(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/agents/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions", agentSlug] }),
  });
}

export function useRenameSession(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      apiFetch(`/api/agents/sessions/${sessionId}`, {
        method: "PATCH",
        body: { title },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions", agentSlug] }),
  });
}
