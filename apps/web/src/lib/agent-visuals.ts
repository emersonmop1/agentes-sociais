/**
 * Central registry of visual identity per agent slug.
 *
 * Single source of truth for the gradient, icon, and display name shown next
 * to every agent in the UI. Replaces the ad-hoc `const INSTA = { emoji: "📸",
 * gradient: [...] }` constants that used to live inside each workspace page.
 *
 * Adding a new agent → add a row here and the AgentAvatar + dashboard pick
 * it up automatically. Removing/renaming an agent slug requires updating the
 * `agent_catalog` DB seed too.
 */

import type { ReactElement } from "react";
import {
  CameraIcon,
  LeafIcon,
  PenIcon,
  PlayIcon,
  TargetIcon,
  VideoIcon,
} from "../components/icons";
import type { IconProps } from "../components/icons";

export type AgentSlug =
  | "brand-bot"
  | "insta-creator"
  | "reels-creator"
  | "copy-master"
  | "ad-master"
  | "youtube-growth";

export interface AgentVisual {
  icon: (props: IconProps) => ReactElement;
  gradient: readonly [string, string];
  label: string;
  /** One-liner used as fallback agent description in cards and stack avatars. */
  blurb: string;
}

export const AGENT_VISUALS: Record<AgentSlug, AgentVisual> = {
  "brand-bot": {
    icon: LeafIcon,
    gradient: ["#22c55e", "#15803d"],
    label: "BrandBot",
    blurb: "Onboarding e descoberta de marca",
  },
  "insta-creator": {
    icon: CameraIcon,
    gradient: ["#ec4899", "#be185d"],
    label: "InstaCreator",
    blurb: "Carrosséis de Instagram que vendem",
  },
  "reels-creator": {
    icon: VideoIcon,
    gradient: ["#8b5cf6", "#6d28d9"],
    label: "ReelsCreator",
    blurb: "Roteiros virais com beats e b-roll",
  },
  "copy-master": {
    icon: PenIcon,
    gradient: ["#3b82f6", "#1d4ed8"],
    label: "CopyMaster",
    blurb: "Email, headlines, scripts de venda",
  },
  "ad-master": {
    icon: TargetIcon,
    gradient: ["#f59e0b", "#b45309"],
    label: "AdMaster",
    blurb: "Criativos pagos e funis Meta/Google",
  },
  "youtube-growth": {
    icon: PlayIcon,
    gradient: ["#ef4444", "#b91c1c"],
    label: "YouTubeGrowth",
    blurb: "Pipeline completo do vídeo ao Studio",
  },
};

export function getAgentVisual(slug: string): AgentVisual | null {
  return slug in AGENT_VISUALS ? AGENT_VISUALS[slug as AgentSlug] : null;
}
