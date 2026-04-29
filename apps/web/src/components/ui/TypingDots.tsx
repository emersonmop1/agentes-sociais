export function TypingDots() {
  return (
    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--text-muted)",
            animation: `pulse-dot 1.2s ${i * 0.15}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}
