import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type MemoryType = "correction" | "knowledge" | "pattern" | "preference";
export type MemorySource =
  | "user_correction"
  | "user_explicit"
  | "agent_extracted"
  | "manual"
  | "user_feedback";

export interface Memory {
  id: string;
  content: string;
  context: string | null;
  category: string | null;
  memory_type: MemoryType;
  source: MemorySource;
  priority: number;
  times_used: number;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useMemories(agentSlug: string) {
  return useQuery({
    queryKey: ["memories", agentSlug],
    queryFn: () =>
      apiFetch<{ memories: Memory[] }>(`/api/agents/${agentSlug}/memories`),
    refetchInterval: 30_000,
  });
}

export function useCreateMemory(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content: string;
      memory_type: MemoryType;
      priority: number;
      category?: string;
    }) =>
      apiFetch<{ memory: Memory }>(`/api/agents/${agentSlug}/memories`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories", agentSlug] }),
  });
}

export function useToggleMemory(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/agents/${agentSlug}/memories/${id}/toggle`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories", agentSlug] }),
  });
}

export function useDeleteMemory(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/agents/${agentSlug}/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories", agentSlug] }),
  });
}

export function useFeedback(agentSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      isPositive,
      comment,
    }: {
      messageId: string;
      isPositive: boolean;
      comment?: string;
    }) =>
      apiFetch<{ memory_id: string; is_positive: boolean }>(
        `/api/agents/${agentSlug}/messages/${messageId}/feedback`,
        {
          method: "POST",
          body: { is_positive: isPositive, comment },
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories", agentSlug] }),
  });
}
