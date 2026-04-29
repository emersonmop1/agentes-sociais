import type { CSSProperties } from "react";

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
  "aria-hidden"?: boolean;
}

/**
 * Helper that returns the props every icon's <svg> root receives. Centralized
 * so every icon picks up the same defaults (currentColor, rounded caps, etc.).
 */
export function iconRootProps(props: IconProps) {
  const { size = 18, color = "currentColor", strokeWidth = 2, style, className } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    className,
    "aria-hidden": props["aria-hidden"] ?? true,
  };
}
