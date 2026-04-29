import type { ReelBeat } from "../../hooks/useReels";
import { Glass } from "../ui/Glass";

export function BeatsTimeline({ beats }: { beats: ReelBeat[] }) {
  if (beats.length === 0) {
    return (
      <Glass style={{ padding: 14, textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 13 }}>Nenhum beat ainda.</div>
      </Glass>
    );
  }

  const total = Math.max(...beats.map((b) => b.end_seconds));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Roteiro · {total}s · {beats.length} beats
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {beats.map((b) => (
          <BeatRow key={b.index} beat={b} totalSeconds={total} />
        ))}
      </div>
    </div>
  );
}

function BeatRow({ beat, totalSeconds }: { beat: ReelBeat; totalSeconds: number }) {
  const widthPct = ((beat.end_seconds - beat.start_seconds) / totalSeconds) * 100;
  const startPct = (beat.start_seconds / totalSeconds) * 100;

  return (
    <Glass style={{ padding: 0, overflow: "hidden" }}>
      {/* Time bar */}
      <div
        style={{
          position: "relative",
          height: 6,
          background: "rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${widthPct}%`,
            top: 0,
            bottom: 0,
            background: "linear-gradient(90deg, var(--green), var(--green-700))",
          }}
        />
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green-700)" }}>
            {beat.start_seconds.toFixed(1)}s – {beat.end_seconds.toFixed(1)}s
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            beat {beat.index + 1}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.45 }}>
          <strong style={{ color: "var(--text-subtle)" }}>Visual: </strong>
          {beat.visual}
        </div>

        {beat.on_camera_speech && (
          <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.45 }}>
            <strong style={{ color: "var(--text-subtle)" }}>Fala: </strong>
            <em>{beat.on_camera_speech}</em>
          </div>
        )}

        {beat.on_screen_text && (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-strong)",
              lineHeight: 1.45,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <strong style={{ color: "var(--text-subtle)" }}>Tela:</strong>
            <span
              style={{
                background: "var(--green-light)",
                color: "var(--green-700)",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {beat.on_screen_text}
            </span>
          </div>
        )}

        {beat.broll_hint && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4, fontStyle: "italic" }}>
            🎥 {beat.broll_hint}
          </div>
        )}
      </div>
    </Glass>
  );
}
