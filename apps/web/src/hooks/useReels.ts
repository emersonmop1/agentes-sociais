import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { env } from "../lib/env";

export type ReelsStatus =
  | "draft"
  | "hooks_review"
  | "hook_picked"
  | "script_review"
  | "script_approved"
  | "caption_review"
  | "caption_approved"
  | "broll_review"
  | "ready"
  | "rejected";

export interface ReelHookOption {
  angle: string;
  hook: string;
  why: string;
}

export interface ReelBeat {
  index: number;
  start_seconds: number;
  end_seconds: number;
  visual: string;
  on_camera_speech: string;
  on_screen_text: string;
  broll_hint?: string;
}

export interface ReelSummary {
  id: string;
  title: string;
  status: ReelsStatus;
  target_duration: number;
  chosen_hook: string | null;
  has_beats: boolean;
  has_caption: boolean;
  has_broll: boolean;
  revision_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReelDetail extends ReelSummary {
  theme: string | null;
  hook_options: ReelHookOption[];
  beats: ReelBeat[];
  caption: string | null;
  cta: string | null;
  hashtags: string[];
  broll_suggestions: string[];
  voice_over_script: string | null;
  edit_notes: string | null;
  rejection_feedback: string | null;
  chat_session_id: string | null;
}

// ─── Queries ─────────────────────────────────────────────────────────────

export function useReelsList() {
  return useQuery({
    queryKey: ["reels", "list"],
    queryFn: () => apiFetch<{ reels: ReelSummary[] }>("/api/reels/scripts"),
    refetchInterval: 10_000,
  });
}

export function useReel(reelId: string | undefined) {
  return useQuery({
    queryKey: ["reels", "detail", reelId],
    queryFn: () =>
      apiFetch<{ reel: ReelDetail }>(`/api/reels/scripts/${reelId}`),
    enabled: Boolean(reelId),
    refetchInterval: 5_000,
  });
}

// ─── Chat ────────────────────────────────────────────────────────────────

export interface ReelChatResponse {
  session_id: string;
  assistant: {
    id: string;
    role: "assistant";
    content: string;
    raw_content: string;
    model: string;
  };
  reel: ReelDetail;
  parsed_stage: "hooks" | "script" | "caption" | "broll" | null;
  memories_used: number;
}

export function useSendReelMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      message: string;
      reel_id?: string;
      user_instructions?: string;
    }) =>
      apiFetch<ReelChatResponse>("/api/reels/chat", {
        method: "POST",
        body: input,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reels", "list"] });
      qc.invalidateQueries({ queryKey: ["reels", "detail", data.reel.id] });
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────

export function usePickHook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reelId,
      hookIndex,
      customHook,
    }: {
      reelId: string;
      hookIndex?: number;
      customHook?: string;
    }) =>
      apiFetch<{ reel: ReelDetail }>(
        `/api/reels/scripts/${reelId}/pick-hook`,
        {
          method: "POST",
          body: { hook_index: hookIndex, custom_hook: customHook },
        },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["reels"] });
    },
  });
}

export function useApproveReel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reelId: string) =>
      apiFetch<{ reel: ReelDetail }>(`/api/reels/scripts/${reelId}/approve`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reels"] }),
  });
}

export function useRejectReel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reelId, feedback }: { reelId: string; feedback: string }) =>
      apiFetch<{ reel: ReelDetail }>(`/api/reels/scripts/${reelId}/reject`, {
        method: "POST",
        body: { feedback },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reels"] }),
  });
}

export function useDeleteReel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reelId: string) =>
      apiFetch(`/api/reels/scripts/${reelId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reels"] }),
  });
}

export function useUpdateReel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reelId,
      patch,
    }: {
      reelId: string;
      patch: Partial<{
        caption: string;
        cta: string;
        hashtags: string[];
        broll_suggestions: string[];
        voice_over_script: string;
        edit_notes: string;
      }>;
    }) =>
      apiFetch<{ reel: ReelDetail }>(`/api/reels/scripts/${reelId}`, {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reels"] }),
  });
}

/**
 * Trigger a PDF download. Returns the blob URL after a click is initiated.
 * We use fetch + Blob because the file requires the JWT in Authorization,
 * which a plain `<a href=...>` can't carry.
 */
export async function downloadReelPdf(reelId: string, filename = "reel.pdf"): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("não autenticado");
  const res = await fetch(
    `${env.API_URL}/api/reels/scripts/${reelId}/export.pdf`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new ApiError(`PDF ${res.status}`, res.status, txt);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
