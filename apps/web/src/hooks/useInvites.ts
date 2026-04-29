import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
export type InviteRole = "admin" | "member";

export interface InviteSummary {
  id: string;
  email: string;
  role: InviteRole | "owner";
  status: InviteStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface CreateInviteResponse {
  invite: InviteSummary;
  /** Only present in the response — the URL is never persisted server-side. */
  invite_url: string;
}

export function useInvitesList() {
  return useQuery({
    queryKey: ["invites", "list"],
    queryFn: () =>
      apiFetch<{ invites: InviteSummary[] }>("/api/companies/me/invites"),
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: InviteRole }) =>
      apiFetch<CreateInviteResponse>("/api/companies/me/invites", {
        method: "POST",
        body: { email, role },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch(`/api/companies/me/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });
}

// ─── Invite preview + accept (invitee side) ──────────────────────────────

export interface InvitePreview {
  email: string;
  role: InviteRole | "owner";
  status: InviteStatus;
  company_name: string | null;
  expires_at: string;
}

export function useInvitePreview(token: string | undefined) {
  return useQuery({
    queryKey: ["invite", "preview", token],
    queryFn: () => apiFetch<InvitePreview>(`/api/invites/${token}`),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ ok: boolean; company_id: string; role: string }>(
        `/api/invites/${token}/accept`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["company"] });
    },
  });
}
