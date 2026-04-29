import type { CSSProperties, ReactNode } from "react";

export interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  variant?: "default" | "green" | "muted";
  style?: CSSProperties;
}

export function Chip({ children, onRemove, variant = "default", style }: ChipProps) {
  const palette = {
    default: { bg: "rgba(255,255,255,0.7)", color: "var(--text-strong)", border: "var(--border)" },
    green: { bg: "var(--green-light)", color: "var(--green-700)", border: "var(--green-border)" },
    muted: { bg: "rgba(0,0,0,0.04)", color: "var(--text-subtle)", border: "transparent" },
  }[variant];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 100,
        background: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        fontSize: 13,
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          style={{
            background: "transparent",
            color: "inherit",
            opacity: 0.6,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
