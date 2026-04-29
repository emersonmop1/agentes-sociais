import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../lib/api";

export interface MeResponse {
  user: { id: string; email: string | null };
  company: { id: string; role: "owner" | "admin" | "member" };
}

/**
 * Loads the current user + active company. Disabled until session exists
 * to avoid an unnecessary 401 round-trip while supabase is still hydrating.
 */
export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/api/me"),
    enabled: Boolean(session),
  });
}
