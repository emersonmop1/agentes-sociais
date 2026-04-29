export type AgentSlug =
  | "brand-bot"
  | "insta-creator"
  | "reels-creator"
  | "copy-master"
  | "ad-master"
  | "youtube-growth";

export type AgentCategory = "onboarding" | "social" | "copy" | "video";

export interface AgentCatalogEntry {
  slug: AgentSlug;
  name: string;
  description: string;
  avatar_emoji: string;
  gradient_colors: [string, string];
  category: AgentCategory;
  is_visible: boolean; // brand-bot is internal, not listed on dashboard
}

export type SessionType =
  | "onboarding"
  | "chat"
  | "insta_creator"
  | "youtube_creator"
  | "reels"
  | "copy"
  | "ad";

export type MessageRole = "user" | "assistant" | "system";

export type MemoryType = "correction" | "knowledge" | "pattern" | "preference";

export type MemorySource =
  | "user_correction"
  | "user_explicit"
  | "agent_extracted"
  | "manual"
  | "user_feedback";
