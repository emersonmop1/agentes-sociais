/**
 * Agent registry — maps slugs to (soul, system_prompt, defaults).
 *
 * Why in code (not DB): souls and system prompts are versionable, code-reviewable,
 * and have non-trivial logic. The DB only stores agent_catalog (UI metadata).
 *
 * BrandBot is registered here too even though its handler lives in
 * modules/onboarding — keeping the registry comprehensive is useful for
 * tooling like /api/admin (future).
 */

import type { ChatOptions } from "../lib/llm/index.js";
import type { SessionType } from "@agentes/shared";
import { SOUL as AD_SOUL } from "./ad-master/soul.js";
import { SYSTEM_PROMPT as AD_SYS } from "./ad-master/system-prompt.js";
import { SOUL as BB_SOUL } from "./brand-bot/soul.js";
import { SOUL as COPY_SOUL } from "./copy-master/soul.js";
import { SYSTEM_PROMPT as COPY_SYS } from "./copy-master/system-prompt.js";
import { SOUL as INSTA_SOUL } from "./insta-creator/soul.js";
import { SOUL as REELS_SOUL } from "./reels-creator/soul.js";
import { SOUL as YT_SOUL } from "./youtube-growth/soul.js";

export interface RegisteredAgent {
  slug: string;
  soul: string;
  /** System prompt for general chat. Some agents (BrandBot) build it dynamically. */
  systemPrompt: string;
  /** Default LLM tier for this agent. */
  defaultTier: NonNullable<ChatOptions["tier"]>;
  /** Default temperature. */
  defaultTemperature: number;
  /** Max output tokens default. */
  defaultMaxTokens: number;
  /** SessionType for chat_sessions when starting a new conversation. */
  defaultSessionType: SessionType;
  /** If true, this agent's chat goes through a normal chat endpoint. */
  isGenericChat: boolean;
}

const REGISTRY: Record<string, RegisteredAgent> = {
  "brand-bot": {
    slug: "brand-bot",
    soul: BB_SOUL,
    systemPrompt: "", // dynamic — built per-turn from companies.onboarding_draft
    defaultTier: "flash",
    defaultTemperature: 0.7,
    defaultMaxTokens: 1024,
    defaultSessionType: "onboarding",
    isGenericChat: false,
  },
  "copy-master": {
    slug: "copy-master",
    soul: COPY_SOUL,
    systemPrompt: COPY_SYS,
    defaultTier: "pro",
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
    defaultSessionType: "copy",
    isGenericChat: true,
  },
  "ad-master": {
    slug: "ad-master",
    soul: AD_SOUL,
    systemPrompt: AD_SYS,
    defaultTier: "pro",
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
    defaultSessionType: "ad",
    isGenericChat: true,
  },
  "insta-creator": {
    slug: "insta-creator",
    soul: INSTA_SOUL,
    systemPrompt: "", // built dynamically per stage in handler
    defaultTier: "pro",
    defaultTemperature: 0.85,
    defaultMaxTokens: 4096,
    defaultSessionType: "insta_creator",
    isGenericChat: false, // pipeline agent, not generic chat
  },
  "reels-creator": {
    slug: "reels-creator",
    soul: REELS_SOUL,
    systemPrompt: "", // built dynamically per stage in handler
    defaultTier: "pro",
    defaultTemperature: 0.85,
    defaultMaxTokens: 4096,
    defaultSessionType: "reels",
    isGenericChat: false,
  },
  "youtube-growth": {
    slug: "youtube-growth",
    soul: YT_SOUL,
    systemPrompt: "", // built dynamically per stage in handler
    defaultTier: "pro",
    defaultTemperature: 0.75,
    defaultMaxTokens: 6000,
    defaultSessionType: "youtube_creator",
    isGenericChat: false,
  },
};

export function getAgent(slug: string): RegisteredAgent | null {
  return REGISTRY[slug] ?? null;
}

export function listAgents(): RegisteredAgent[] {
  return Object.values(REGISTRY);
}
