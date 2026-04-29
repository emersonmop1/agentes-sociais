export interface LogoProps {
  size?: number;
  showTag?: boolean;
}

/**
 * Placeholder logo. Replace with real brand mark in Fatia 1+.
 * Squircle with gradient and lowercase 'a' for "agentes".
 */
export function Logo({ size = 36, showTag = false }: LogoProps) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size / 3,
          background: "linear-gradient(135deg, var(--green), var(--green-700))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size * 0.5,
          boxShadow: "0 4px 16px rgba(34,197,94,0.3)",
        }}
      >
        a
      </div>
      {showTag && (
        <span
          style={{
            fontSize: size * 0.45,
            fontWeight: 700,
            color: "var(--text-strong)",
            letterSpacing: "-0.02em",
          }}
        >
          agentes<span style={{ color: "var(--green)" }}>.</span>sociais
        </span>
      )}
    </div>
  );
}
