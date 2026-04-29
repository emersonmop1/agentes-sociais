import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  blur?: number;
}

export function Glass({ children, style, blur = 24, ...rest }: GlassProps) {
  const glassStyle: CSSProperties = {
    background: "var(--surface-glass)",
    border: "1px solid var(--surface-glass-border)",
    boxShadow: "var(--surface-glass-shadow)",
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    borderRadius: "var(--radius)",
    ...style,
  };
  return (
    <div style={glassStyle} {...rest}>
      {children}
    </div>
  );
}
