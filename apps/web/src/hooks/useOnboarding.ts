import type { OnboardingDraft } from "@agentes/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface OnboardingMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface OnboardingState {
  company_id: string;
  company_name: string;
  onboarding_completed: boolean;
  draft: OnboardingDraft;
  ready_to_finish: boolean;
  session_id: string;
  messages: OnboardingMessage[];
}

export function useOnboardingState() {
  return useQuery({
    queryKey: ["onboarding", "state"],
    queryFn: () => apiFetch<OnboardingState>("/api/onboarding/state"),
  });
}

interface SendMessageResponse {
  message: OnboardingMessage;
  draft: OnboardingDraft;
  ready_to_finish: boolean;
}

export function useSendOnboardingMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<SendMessageResponse>("/api/onboarding/messages", {
        method: "POST",
        body: { content },
      }),
    onMutate: async (content) => {
      // Optimistically append the user's bubble so they see their own
      // message instantly. Onboarding doesn't return the user's message
      // back from the server (only the assistant's reply), so we have to
      // synthesize one client-side.
      const tempUserMsg: OnboardingMessage = {
        id: `tmp-user-${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<OnboardingState | undefined>(
        ["onboarding", "state"],
        (prev) =>
          prev
            ? { ...prev, messages: [...prev.messages, tempUserMsg] }
            : prev,
      );
    },
    onSuccess: (data) => {
      // Append the assistant's reply + bump draft/ready flags. The user's
      // optimistic bubble from onMutate is already in place.
      qc.setQueryData<OnboardingState | undefined>(
        ["onboarding", "state"],
        (prev) =>
          prev
            ? {
                ...prev,
                draft: data.draft,
                ready_to_finish: data.ready_to_finish,
                messages: [...prev.messages, data.message],
              }
            : prev,
      );
    },
    onError: () => {
      // Rollback by refetching — drops the optimistic user bubble.
      qc.invalidateQueries({ queryKey: ["onboarding", "state"] });
    },
  });
}

export function usePatchDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<OnboardingDraft>) =>
      apiFetch<{ draft: OnboardingDraft; ready_to_finish: boolean }>(
        "/api/onboarding/draft",
        { method: "PATCH", body: patch },
      ),
    onSuccess: (data) => {
      qc.setQueryData<OnboardingState | undefined>(
        ["onboarding", "state"],
        (prev) =>
          prev
            ? {
                ...prev,
                draft: data.draft,
                ready_to_finish: data.ready_to_finish,
              }
            : prev,
      );
    },
  });
}

/**
 * Uploads a logo image and patches onboarding_draft.logo_url server-side.
 * Server also appends a "[anexei meu logo: ...]" pseudo-message to the chat
 * history so the next BrandBot turn acknowledges the upload.
 */
export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<{ logo_url: string; draft: OnboardingDraft }> => {
      const dataUrl = await fileToDataUrl(file);
      return apiFetch<{ logo_url: string; draft: OnboardingDraft; ready_to_finish: boolean }>(
        "/api/onboarding/upload-logo",
        { method: "POST", body: { data_url: dataUrl } },
      );
    },
    onSuccess: (data) => {
      // Refetch the full state so the new "[anexei meu logo: ...]" message
      // appears in the conversation timeline on the left.
      qc.invalidateQueries({ queryKey: ["onboarding", "state"] });
      // Also patch in-place so the DraftPreview updates instantly without
      // waiting for the refetch round-trip.
      qc.setQueryData<OnboardingState | undefined>(
        ["onboarding", "state"],
        (prev) =>
          prev
            ? { ...prev, draft: data.draft }
            : prev,
      );
    },
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; company_id: string }>("/api/onboarding/complete", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
