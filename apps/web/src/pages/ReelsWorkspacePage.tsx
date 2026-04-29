import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BeatsTimeline } from "../components/reels/BeatsTimeline";
import { HookPicker } from "../components/reels/HookPicker";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { CTA } from "../components/ui/CTA";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { QuotaBadge } from "../components/ui/QuotaBadge";
import { TypingDots } from "../components/ui/TypingDots";
import {
  downloadReelPdf,
  useApproveReel,
  useDeleteReel,
  useReel,
  useReelsList,
  useRejectReel,
  useSendReelMessage,
  type ReelDetail,
  type ReelSummary,
  type ReelsStatus,
} from "../hooks/useReels";

const REELS = { emoji: "🎬", gradient: ["#8b5cf6", "#6d28d9"] as const };

const STATUS_LABEL: Record<ReelsStatus, string> = {
  draft: "Novo",
  hooks_review: "Escolher gancho",
  hook_picked: "Gerando roteiro",
  script_review: "Revisar roteiro",
  script_approved: "Pronto p/ caption",
  caption_review: "Revisar caption",
  caption_approved: "Pronto p/ B-roll",
  broll_review: "Revisar B-roll",
  ready: "Pronto",
  rejected: "Rejeitado",
};

const STATUS_COLOR: Record<ReelsStatus, string> = {
  draft: "var(--text-muted)",
  hooks_review: "#f59e0b",
  hook_picked: "#3b82f6",
  script_review: "#8b5cf6",
  script_approved: "#3b82f6",
  caption_review: "#3b82f6",
  caption_approved: "#3b82f6",
  broll_review: "#3b82f6",
  ready: "#22c55e",
  rejected: "var(--error)",
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export function ReelsWorkspacePage() {
  const navigate = useNavigate();
  const { data: list } = useReelsList();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: detail } = useReel(activeId ?? undefined);
  const send = useSendReelMessage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset chat when switching reels
  useEffect(() => {
    setMessages([]);
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, send.isPending]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `tmp-u-${Date.now()}`, role: "user", content: text },
    ]);
    try {
      const r = await send.mutateAsync({ message: text, reel_id: activeId ?? undefined });
      if (!activeId) setActiveId(r.reel.id);
      setMessages((prev) => [
        ...prev,
        { id: r.assistant.id, role: "assistant", content: r.assistant.content },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "system", content: `Erro: ${(err as Error).message}` },
      ]);
    }
  };

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh" }}>
      <header
        style={{
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          background: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <button onClick={() => navigate("/dashboard")} style={{ background: "transparent", padding: 0 }}>
          <Logo size={28} showTag />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AgentAvatar emoji={REELS.emoji} gradient={REELS.gradient} size={32} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>ReelsCreator</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Roteiros virais com beats e B-roll
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <QuotaBadge kind="reels" />
          <button
            onClick={() => navigate("/dashboard")}
            style={{ background: "transparent", color: "var(--text-subtle)", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8 }}
          >
            ← Dashboard
          </button>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr) minmax(360px, 420px)",
          gap: 16,
          padding: "16px",
          height: "calc(100dvh - 65px)",
        }}
      >
        {/* Left: list */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
          <button
            onClick={() => {
              setActiveId(null);
              setMessages([]);
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: !activeId
                ? "linear-gradient(135deg, var(--green), var(--green-600))"
                : "transparent",
              color: !activeId ? "#fff" : "var(--text-strong)",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo Reel
          </button>
          {(list?.reels ?? []).map((r) => (
            <ReelCard key={r.id} reel={r} active={r.id === activeId} onClick={() => setActiveId(r.id)} />
          ))}
        </aside>

        {/* Center: detail / hook picker / beats / caption / broll */}
        <main style={{ overflowY: "auto", padding: "0 4px" }}>
          {!activeId ? (
            <EmptyState />
          ) : !detail ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
              <Spinner />
            </div>
          ) : (
            <ReelDetailView reel={detail.reel} />
          )}
        </main>

        {/* Right: chat */}
        <aside style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Glass
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              padding: 0,
              overflow: "hidden",
            }}
          >
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.length === 0 ? (
                <ChatBubble
                  role="assistant"
                  content={
                    activeId
                      ? "Continue conversando comigo aqui pra avançar de etapa, ajustar o roteiro ou pedir variações."
                      : "Pronta. Conta o tema do Reel + duração-alvo (15s / 30s / 60s / 90s) e eu gero 5 ângulos de gancho diferentes."
                  }
                />
              ) : (
                messages.map((m) => <ChatBubble key={m.id} role={m.role} content={m.content} />)
              )}
              {send.isPending && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <AgentAvatar emoji={REELS.emoji} gradient={REELS.gradient} size={24} />
                  <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.04)", borderRadius: 14 }}>
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                padding: 10,
                borderTop: "1px solid var(--border)",
                display: "flex",
                gap: 8,
                alignItems: "flex-end",
                background: "rgba(255,255,255,0.5)",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                rows={1}
                placeholder={detail?.reel?.status === "ready" ? "Reel pronto. Quer variação?" : "Sua mensagem…"}
                disabled={send.isPending}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  fontSize: 14,
                  fontFamily: "inherit",
                  resize: "none",
                  outline: "none",
                  color: "var(--text-strong)",
                  minHeight: 24,
                  maxHeight: 120,
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || send.isPending}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background:
                    input.trim() && !send.isPending
                      ? "linear-gradient(135deg, var(--green), var(--green-700))"
                      : "rgba(0,0,0,0.08)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-label="Enviar"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </Glass>
        </aside>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ReelCard({
  reel,
  active,
  onClick,
}: {
  reel: ReelSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Glass
      onClick={onClick}
      style={{
        padding: 12,
        cursor: "pointer",
        border: active ? "2px solid var(--green-border)" : "1px solid var(--surface-glass-border)",
        background: active ? "var(--green-light)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: STATUS_COLOR[reel.status],
          }}
        >
          {STATUS_LABEL[reel.status]}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{reel.target_duration}s</span>
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-strong)",
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {reel.title}
      </div>
    </Glass>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 16,
        padding: 64,
        color: "var(--text-muted)",
      }}
    >
      <div style={{ fontSize: 48 }}>🎬</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-strong)" }}>
        Pronta pra criar um Reel
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 480 }}>
        Manda no chat ao lado: tema + duração-alvo (15s / 30s / 60s / 90s).
        Eu gero 5 ângulos de gancho, depois roteiro com beats, caption e B-roll.
      </p>
    </div>
  );
}

function ReelDetailView({ reel }: { reel: ReelDetail }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ReelHeader reel={reel} />
      {reel.rejection_feedback && (
        <Glass
          style={{
            padding: 12,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--error)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Feedback da rejeição anterior
          </div>
          <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.5 }}>
            {reel.rejection_feedback}
          </div>
        </Glass>
      )}

      {/* Stage-specific main content */}
      {reel.status === "hooks_review" && <HookPicker reel={reel} />}

      {(reel.status === "hook_picked" ||
        reel.status === "script_review" ||
        reel.status === "script_approved" ||
        reel.status === "caption_review" ||
        reel.status === "caption_approved" ||
        reel.status === "broll_review" ||
        reel.status === "ready") && (
        <>
          {reel.chosen_hook && <HookCard hook={reel.chosen_hook} />}
          {reel.beats.length > 0 && <BeatsTimeline beats={reel.beats} />}
          {reel.caption && <CaptionCard reel={reel} />}
          {(reel.broll_suggestions.length > 0 || reel.voice_over_script) && (
            <BrollCard reel={reel} />
          )}
        </>
      )}

      <ReviewActions reel={reel} />
    </div>
  );
}

function ReelHeader({ reel }: { reel: ReelDetail }) {
  const del = useDeleteReel();
  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                background: STATUS_COLOR[reel.status],
                padding: "3px 8px",
                borderRadius: 100,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {STATUS_LABEL[reel.status]}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {reel.target_duration}s · {reel.revision_count} revisão{reel.revision_count === 1 ? "" : "ões"}
            </span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-strong)" }}>
            {reel.title}
          </h2>
          {reel.theme && (
            <div style={{ fontSize: 13, color: "var(--text-subtle)", marginTop: 2 }}>
              {reel.theme}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {reel.status === "ready" && <ExportPdfButton reel={reel} />}
          <button
            onClick={() => {
              if (window.confirm("Excluir este reel?")) {
                del.mutate(reel.id);
              }
            }}
            style={{ background: "transparent", color: "var(--text-muted)", fontSize: 12, padding: "6px 10px", borderRadius: 8 }}
          >
            Excluir
          </button>
        </div>
      </div>
    </Glass>
  );
}

function HookCard({ hook }: { hook: string }) {
  return (
    <Glass style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        Hook
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--green-700)", lineHeight: 1.35 }}>
        {hook}
      </div>
    </Glass>
  );
}

function CaptionCard({ reel }: { reel: ReelDetail }) {
  return (
    <Glass style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Caption
      </div>
      <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {reel.caption}
      </div>
      {reel.cta && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            background: "var(--green-light)",
            border: "1px solid var(--green-border)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--green-700)",
          }}
        >
          CTA: {reel.cta}
        </div>
      )}
      {reel.hashtags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
          {reel.hashtags.map((h) => (
            <span
              key={h}
              style={{
                fontSize: 11,
                color: "var(--green-700)",
                background: "var(--green-light)",
                padding: "2px 8px",
                borderRadius: 100,
              }}
            >
              {h.startsWith("#") ? h : `#${h}`}
            </span>
          ))}
        </div>
      )}
    </Glass>
  );
}

function BrollCard({ reel }: { reel: ReelDetail }) {
  return (
    <Glass style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Produção
      </div>

      {reel.broll_suggestions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)", marginBottom: 4 }}>
            B-roll a gravar
          </div>
          <ul style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5, paddingLeft: 18, margin: 0 }}>
            {reel.broll_suggestions.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {reel.voice_over_script && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)", marginBottom: 4 }}>
            Voice-over
          </div>
          <div style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {reel.voice_over_script}
          </div>
        </div>
      )}

      {reel.edit_notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)", marginBottom: 4 }}>
            Notas de edição
          </div>
          <div style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5 }}>
            {reel.edit_notes}
          </div>
        </div>
      )}
    </Glass>
  );
}

function ReviewActions({ reel }: { reel: ReelDetail }) {
  const approve = useApproveReel();
  const reject = useRejectReel();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const reviewable =
    reel.status === "script_review" ||
    reel.status === "caption_review" ||
    reel.status === "broll_review";
  if (!reviewable) return null;

  const labelMap: Record<string, string> = {
    script_review: "Aprovar roteiro",
    caption_review: "Aprovar caption",
    broll_review: "Aprovar produção e marcar pronto",
  };

  const handleReject = async () => {
    if (!feedback.trim()) return;
    await reject.mutateAsync({ reelId: reel.id, feedback: feedback.trim() });
    setRejectOpen(false);
    setFeedback("");
  };

  return (
    <Glass style={{ padding: 12 }}>
      {!rejectOpen ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <button
            onClick={() => setRejectOpen(true)}
            style={{
              background: "transparent",
              color: "var(--error)",
              border: "1px solid var(--error)",
              padding: "8px 16px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Rejeitar
          </button>
          <CTA onClick={() => approve.mutate(reel.id)} disabled={approve.isPending}>
            {labelMap[reel.status] ?? "Aprovar"} →
          </CTA>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="O que tá ruim? (vai voltar pro draft + agente vai considerar isso)"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setRejectOpen(false);
                setFeedback("");
              }}
              style={{ background: "transparent", color: "var(--text-subtle)", padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
            >
              Cancelar
            </button>
            <button
              onClick={handleReject}
              disabled={!feedback.trim() || reject.isPending}
              style={{
                background: "var(--error)",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                opacity: !feedback.trim() || reject.isPending ? 0.5 : 1,
                cursor: !feedback.trim() || reject.isPending ? "not-allowed" : "pointer",
              }}
            >
              Rejeitar
            </button>
          </div>
        </div>
      )}
    </Glass>
  );
}

function ExportPdfButton({ reel }: { reel: ReelDetail }) {
  const [downloading, setDownloading] = useState(false);
  const handle = async () => {
    setDownloading(true);
    try {
      await downloadReelPdf(
        reel.id,
        `reel-${reel.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`,
      );
    } catch (err) {
      alert("Falha ao baixar PDF: " + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button
      onClick={() => void handle()}
      disabled={downloading}
      style={{
        background: "linear-gradient(135deg, var(--green), var(--green-700))",
        color: "#fff",
        padding: "8px 16px",
        borderRadius: 100,
        fontSize: 12,
        fontWeight: 700,
        cursor: downloading ? "not-allowed" : "pointer",
        opacity: downloading ? 0.6 : 1,
        border: "none",
      }}
    >
      {downloading ? "Baixando…" : "📄 Baixar PDF"}
    </button>
  );
}

function ChatBubble({ role, content }: { role: ChatMessage["role"]; content: string }) {
  const isUser = role === "user";
  const isSystem = role === "system";
  if (isSystem) {
    return (
      <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.08)", color: "var(--error)", borderRadius: 8, fontSize: 12 }}>
        {content}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: isUser ? "row-reverse" : "row" }}>
      {!isUser && <AgentAvatar emoji={REELS.emoji} gradient={REELS.gradient} size={24} />}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 14,
          background: isUser
            ? "linear-gradient(135deg, var(--green), var(--green-600))"
            : "rgba(255,255,255,0.7)",
          color: isUser ? "#fff" : "var(--text-strong)",
          border: isUser ? "none" : "1px solid var(--border)",
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: "85%",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content}
      </div>
    </div>
  );
}
