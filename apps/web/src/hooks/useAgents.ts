import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export interface AgentCatalogItem {
  slug: string;
  name: string;
  description: string;
  avatar_emoji: string;
  gradient: [string, string];
  category: "onboarding" | "social" | "copy" | "video";
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiFetch<{ agents: AgentCatalogItem[] }>("/api/agents"),
    staleTime: 5 * 60 * 1000,
  });
}
