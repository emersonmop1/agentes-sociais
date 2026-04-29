/**
 * Spinner — circular loader. 36px default to match Masi's `LoadingView`.
 * Border thickness scales with size so a tiny inline 14px spinner doesn't
 * look comically thick.
 */

export interface SpinnerProps {
  size?: number;
  color?: string;
  /** Optional thickness override; otherwise scaled from size. */
  thickness?: number;
}

export function Spinner({ size = 36, color = "var(--green)", thickness }: SpinnerProps) {
  const border = thickness ?? Math.max(2, Math.round(size / 12));
  return (
    <div
      role="status"
      aria-label="Carregando"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${border}px solid var(--green-light)`,
        borderTopColor: color,
        animation: "spin 0.8s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

/**
 * LoadingView — full-screen wrapper for "page is loading" moments. Mirrors
 * Masi's component of the same name. Use sparingly: most loading states
 * should be inline (component-level Spinner) so the user has visual context
 * about what's loading.
 */
export function LoadingView({ message }: { message?: string }) {
  return (
    <div
      role="status"
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        gap: 16,
      }}
    >
      <Spinner size={36} />
      {message && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
          {message}
        </div>
      )}
    </div>
  );
}
