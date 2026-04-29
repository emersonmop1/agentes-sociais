import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../lib/api";

export interface CompanyMeResponse {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro";
  onboarding_completed: boolean;
  quotas: {
    posts_remaining: number;
    reels_remaining: number;
    youtube_remaining: number;
    chat_remaining: number;
    resets_at: string;
  };
}

/**
 * Active company snapshot — quotas, plan, onboarding flag. Refetched after
 * any creation flow that may have decremented a quota counter.
 */
export function useCompany() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["company", "me"],
    queryFn: () => apiFetch<CompanyMeResponse>("/api/companies/me"),
    enabled: Boolean(session),
    staleTime: 30_000,
  });
}
