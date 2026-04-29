import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

export interface CTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
}

export function CTA({ children, variant = "primary", style, ...rest }: CTAProps) {
  const [hover, setHover] = useState(false);
  const isPrimary = variant === "primary";

  const base = {
    padding: "14px 28px",
    minHeight: 48,
    borderRadius: "var(--radius-pill)",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "inherit",
    transition: "all 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    cursor: rest.disabled ? "not-allowed" : "pointer",
    opacity: rest.disabled ? 0.5 : 1,
    border: "none",
  } as const;

  const primaryStyle = {
    background: hover
      ? "linear-gradient(135deg, var(--green-600), var(--green-700))"
      : "linear-gradient(135deg, var(--green), var(--green-600))",
    color: "#fff",
    boxShadow: hover
      ? "0 8px 24px rgba(34,197,94,0.35)"
      : "0 4px 16px rgba(34,197,94,0.25)",
    transform: hover ? "translateY(-1px)" : "translateY(0)",
  };

  const secondaryStyle = {
    background: "rgba(255,255,255,0.7)",
    color: "var(--text-strong)",
    border: "1.5px solid var(--border)",
  };

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...(isPrimary ? primaryStyle : secondaryStyle), ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
