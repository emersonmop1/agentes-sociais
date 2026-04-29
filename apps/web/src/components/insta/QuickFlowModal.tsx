import { useState, type FormEvent, type ReactElement } from "react";
import { useQuickFlow } from "../../hooks/useQuickFlow";
import type { VisualStyleSlug } from "../../hooks/useInstaPosts";
import { Glass } from "../ui/Glass";

const STYLE_OPTIONS: { value: VisualStyleSlug; label: string }[] = [
  { value: "tweet_thread", label: "Tweet thread" },
  { value: "dark", label: "Dark" },
  { value: "acid_text", label: "Acid text" },
  { value: "tweet_single", label: "Tweet único" },
];

interface QuickFlowModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user clicks a generated post to open it. */
  onSelectPost?: (postId: string) => void;
  /** Quota cap so we don't let the user pick more than they have. */
  maxCount: number;
}

export function QuickFlowModal({
  open,
  onClose,
  onSelectPost,
  maxCount,
}: QuickFlowModalProps): ReactElement | null {
  const [count, setCount] = useState(3);
  const [seed, setSeed] = useState("");
  const [style, setStyle] = useState<VisualStyleSlug>("tweet_thread");
  const { state, start, reset } = useQuickFlow();

  if (!open) return null;

  const handleStart = (e?: FormEvent) => {
    e?.preventDefault();
    if (state.phase === "running" || state.phase === "planning") return;
    const safeCount = Math.min(Math.max(1, count), Math.min(maxCount, 5));
    void start({
      count: safeCount,
      visual_style: style,
      seed: seed.trim() || undefined,
    });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const isWorking = state.phase === "planning" || state.phase === "running";
  const ceiling = Math.min(maxCount, 5);

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(15, 23, 42, 0.5)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isWorking) handleClose();
      }}
    >
      <Glass
        style={{
          padding: 28,
          maxWidth: 640,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-h)", letterSpacing: "-0.02em", marginBottom: 4 }}>
              Quick Flow
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-subtle)" }}>
              Gera N carrosséis em sequência com ângulos únicos — entram no kanban como rascunho.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isWorking}
            style={{
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 22,
              padding: "0 8px",
              cursor: isWorking ? "not-allowed" : "pointer",
              opacity: isWorking ? 0.4 : 1,
            }}
          >
            ×
          </button>
        </div>

        {state.phase === "idle" || state.phase === "error" ? (
          <form onSubmit={handleStart}>
            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Quantidade
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  max={ceiling}
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                  style={{
                    width: 88,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  de {ceiling} disponíveis
                </span>
              </div>
            </label>

            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Estilo visual
              </div>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as VisualStyleSlug)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "block", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Direção <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-subtle)" }}>(opcional)</span>
              </div>
              <textarea
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Ex: produtividade pra dev iniciante, sem clichê de café…"
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  resize: "vertical",
                }}
              />
            </label>

            {state.phase === "error" && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#b91c1c",
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {state.errorMessage}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: "10px 20px",
                  borderRadius: 100,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-strong)",
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={maxCount === 0}
                style={{
                  padding: "10px 24px",
                  borderRadius: 100,
                  background:
                    maxCount === 0
                      ? "var(--text-muted)"
                      : "linear-gradient(135deg, var(--green), var(--green-600))",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor: maxCount === 0 ? "not-allowed" : "pointer",
                }}
              >
                {maxCount === 0 ? "Quota esgotada" : "Iniciar geração"}
              </button>
            </div>
          </form>
        ) : (
          <RunView state={state} onSelectPost={onSelectPost} onClose={handleClose} />
        )}
      </Glass>
    </div>
  );
}

function RunView({
  state,
  onSelectPost,
  onClose,
}: {
  state: ReturnType<typeof useQuickFlow>["state"];
  onSelectPost?: (postId: string) => void;
  onClose: () => void;
}): ReactElement {
  const isDone = state.phase === "done";
  const headline =
    state.phase === "planning"
      ? "Planejando ângulos únicos…"
      : state.phase === "running"
        ? `Gerando ${state.posts.length + state.skipped.length}/${state.total}…`
        : `Concluído — ${state.posts.length} criado${state.posts.length === 1 ? "" : "s"}, ${state.skipped.length} pulado${state.skipped.length === 1 ? "" : "s"}.`;

  return (
    <div>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--green-light)",
          border: "1px solid var(--green-border)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-strong)",
          marginBottom: 16,
        }}
      >
        {headline}
      </div>

      {state.topics.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Plano ({state.topics.length})
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {state.topics.map((t, idx) => {
              const created = state.posts.find((p) => p.index === idx);
              const skipped = state.skipped.find((s) => s.index === idx);
              const status = created ? "✓" : skipped ? "✗" : "•";
              const color = created ? "var(--success)" : skipped ? "var(--error)" : "var(--text-muted)";
              return (
                <li key={`${idx}-${t.title}`} style={{ fontSize: 13, color: "var(--text-strong)" }}>
                  <span style={{ color, fontWeight: 700, marginRight: 6 }}>{status}</span>
                  <strong>{t.title}</strong>
                  <span style={{ color: "var(--text-subtle)", marginLeft: 6 }}>— {t.angle}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {state.posts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Criados
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.posts.map((p) => (
              <button
                key={p.post.id}
                onClick={() => onSelectPost?.(p.post.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.5)",
                  border: "1px solid var(--border)",
                  textAlign: "left",
                  fontSize: 13,
                  color: "var(--text-strong)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.post.title}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                  {p.post.slides_count} slides
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {state.skipped.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--error)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Pulados ({state.skipped.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-subtle)" }}>
            {state.skipped.map((s, i) => (
              <div key={`${s.index}-${i}`}>
                <strong>{s.topic_title}</strong> — {labelReason(s.reason)}
                {s.error && (
                  <span style={{ color: "var(--text-muted)" }}>: {s.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {state.errorMessage && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#b91c1c",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {state.errorMessage}
        </div>
      )}

      {isDone || state.phase === "error" ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 24px",
              borderRadius: 100,
              background: "linear-gradient(135deg, var(--green), var(--green-600))",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              border: "none",
            }}
          >
            Fechar
          </button>
        </div>
      ) : null}
    </div>
  );
}

function labelReason(reason: string): string {
  switch (reason) {
    case "quota_exceeded":
      return "quota esgotada";
    case "agent_no_copy":
      return "agente não retornou copy parseável";
    case "agent_failed":
      return "erro no agente";
    default:
      return reason;
  }
}
