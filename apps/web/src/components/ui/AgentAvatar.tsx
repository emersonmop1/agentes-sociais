/**
 * AgentAvatar — gradient square (32% radius) with the agent's SVG icon at the
 * center. Mirrors the Masi reference treatment (`masi-negocios-prot/src/
 * components/ui/AgentAvatar.jsx`) but uses our SVG icon set instead of photo
 * portraits.
 *
 * Three ways to call it (in priority order):
 *   1. By slug (`<AgentAvatar slug="insta-creator" />`) — looks up icon +
 *      gradient from AGENT_VISUALS automatically. Preferred.
 *   2. With explicit icon + gradient — escape hatch for one-offs (e.g. agent
 *      catalog rows the registry doesn't know about yet).
 *   3. Legacy `emoji` prop — kept for workspaces (Insta/Reels/YT/AgentPage)
 *      that still pass an emoji string until sprint #2 finishes converting
 *      them. Renders the emoji centered over the gradient as text. Marked
 *      deprecated in the type so new code stops using it.
 *
 * `pulse=true` adds a soft outward ring animation, used to mark "agente
 * ativo" indicators on the dashboard.
 */

import type { CSSProperties, ReactElement } from "react";
import type { IconProps } from "../icons";
import { AGENT_VISUALS, type AgentSlug } from "../../lib/agent-visuals";

type IconComponent = (props: IconProps) => ReactElement;

export interface AgentAvatarProps {
  size?: number;
  pulse?: boolean;
  style?: CSSProperties;
  /** Preferred — looks up icon + gradient from AGENT_VISUALS. */
  slug?: AgentSlug | string;
  /** Optional override or one-off agent not in the registry. */
  icon?: IconComponent;
  /** Required when icon is set; optional override when slug is set. */
  gradient?: readonly [string, string];
  /**
   * @deprecated Pass `slug` (or `icon` + `gradient`) instead. The string still
   * renders for now so workspace pages keep compiling until sprint #2.
   */
  emoji?: string;
}

const FALLBACK_GRADIENT: readonly [string, string] = ["#94a3b8", "#475569"];

export function AgentAvatar(props: AgentAvatarProps) {
  const size = props.size ?? 40;

  const resolved =
    props.slug && props.slug in AGENT_VISUALS
      ? AGENT_VISUALS[props.slug as AgentSlug]
      : null;

  const Icon: IconComponent | null = props.icon ?? resolved?.icon ?? null;
  const gradient = props.gradient ?? resolved?.gradient ?? FALLBACK_GRADIENT;
  const radius = Math.round(size * 0.32);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: [
          `0 4px 12px ${gradient[0]}30`,
          // soft inner highlight, mirrors Masi's inset top-edge sheen
          `inset 0 1px 0 rgba(255,255,255,0.25)`,
        ].join(", "),
        position: "relative",
        ...props.style,
      }}
    >
      {Icon ? (
        <Icon size={Math.round(size * 0.45)} color="#fff" strokeWidth={2.25} />
      ) : props.emoji ? (
        <span
          aria-hidden
          style={{
            fontSize: size * 0.5,
            lineHeight: 1,
            // emoji escape-hatch — sprint #2 removes this entire branch
          }}
        >
          {props.emoji}
        </span>
      ) : null}
      {props.pulse && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: radius,
            boxShadow: `0 0 0 0 ${gradient[0]}60`,
            animation: "agentAvatarPulse 2s ease-out infinite",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
