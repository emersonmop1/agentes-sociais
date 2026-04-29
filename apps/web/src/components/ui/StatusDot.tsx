/**
 * StatusDot — small pulsing indicator for "online", "pending", "error" states.
 *
 * Default size is 8px (matches Masi's StatusDot in the welcome badge). The
 * pulse animation is `pulse-dot` from index.css. Reduced-motion users see a
 * static dot via the global media query.
 */

export type StatusDotKind = "online" | "pending" | "error" | "info";

const COLOR: Record<StatusDotKind, string> = {
  online: "#22c55e",
  pending: "#f59e0b",
  error: "#ef4444",
  info: "#3b82f6",
};

export interface StatusDotProps {
  kind?: StatusDotKind;
  size?: number;
  /** Disable the pulse animation (e.g. for static legend badges). */
  static?: boolean;
}

export function StatusDot({
  kind = "online",
  size = 8,
  static: isStatic = false,
}: StatusDotProps) {
  const color = COLOR[kind];
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 ${Math.max(2, size / 4)}px ${color}33`,
        flexShrink: 0,
        animation: isStatic ? undefined : "pulse-dot 2s ease-in-out infinite",
      }}
    />
  );
}
