import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { KanbanBoard } from "../components/insta/KanbanBoard";
import { PostDetailModal } from "../components/insta/PostDetailModal";
import { QuickFlowModal } from "../components/insta/QuickFlowModal";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { CTA } from "../components/ui/CTA";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { TypingDots } from "../components/ui/TypingDots";
import { useInstaSendMessage, type InstaChatMessage } from "../hooks/useInstaChat";
import { useKanban, type VisualStyleSlug } from "../hooks/useInstaPosts";
import { useCompany } from "../hooks/useCompany";

const INSTA = { emoji: "📸", gradient: ["#ec4899", "#be185d"] as const };

const VISUAL_STYLE_OPTIONS: { value: VisualStyleSlug; label: string; blurb: string }[] = [
  { value: "tweet_thread", label: "Tweet Carrossel", blurb: "Branco, header, foto real" },
  { value: "dark", label: "Dark", blurb: "Preto, IA cinematográfica" },
  { value: "acid_text", label: "Texto Ácido", blurb: "Só texto provocativo" },
  { value: "tweet_single", label: "Post Único", blurb: "Uma imagem, frase grande" },
];

const OPENING_MESSAGE: InstaChatMessage = {
  id: "opener",
  role: "assistant",
  content:
    "Pronta pra criar carrosséis. Conta o tema (de preferência uma história, não tutorial) e me diga o estilo visual:\n\n• tweet_thread (Tweet Carrossel)\n• dark\n• acid_text (só texto)\n• tweet_single (post único)\n\nOu se preferir, escolhe um estilo no seletor aí em cima e manda só o tema.",
  created_at: new Date().toISOString(),
};

export function InstaWorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: kanbanData } = useKanban();
  const send = useInstaSendMessage();
  const [igFlash, setIgFlash] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [quickFlowOpen, setQuickFlowOpen] = useState(false);
  const { data: company } = useCompany();

  // Handle Instagram OAuth callback redirect (?ig_connect=ok|error)
  useEffect(() => {
    const status = searchParams.get("ig_connect");
    if (!status) return;
    if (status === "ok") {
      const username = searchParams.get("username");
      setIgFlash({
        kind: "ok",
        text: username ? `Instagram conectado como @${username}` : "Instagram conectado",
      });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } else {
      const reason = searchParams.get("reason") ?? "erro desconhecido";
      setIgFlash({ kind: "error", text: `Falha ao conectar: ${reason}` });
    }
    // Clear params after consuming
    searchParams.delete("ig_connect");
    searchParams.delete("username");
    searchParams.delete("reason");
    setSearchParams(searchParams, { replace: true });
    const t = setTimeout(() => setIgFlash(null), 6000);
    return () => clearTimeout(t);
  }, [searchParams, setSearchParams, qc]);

  const [messages, setMessages] = useState<InstaChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [visualStyle, setVisualStyle] = useState<VisualStyleSlug>("tweet_thread");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, send.isPending]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;

    setInput("");
    const tempUserId = `tmp-user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: "user", content: text, created_at: new Date().toISOString() },
    ]);

    try {
      const r = await send.mutateAsync({
        message: text,
        session_id: sessionId,
        visual_style: visualStyle,
      });
      if (!sessionId) setSessionId(r.session_id);
      setMessages((prev) => [
        ...prev,
        {
          id: r.assistant.id,
          role: "assistant",
          content: r.assistant.content,
          created_at: new Date().toISOString(),
          metadata: r.post ? { post_id: r.post.id } : undefined,
        },
      ]);
      // If a post was created, auto-open the modal so the user can review
      if (r.post) setActivePostId(r.post.id);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "system",
          content: `Erro: ${(err as Error).message}`,
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  const messagesToRender = messages.length === 0 ? [OPENING_MESSAGE] : messages;

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
          <AgentAvatar emoji={INSTA.emoji} gradient={INSTA.gradient} size={32} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>
              InstaCreator
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Carrosséis com revisão humana etapa-a-etapa
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/dashboard")}
          style={{ background: "transparent", color: "var(--text-subtle)", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8 }}
        >
          ← Dashboard
        </button>
      </header>

      {igFlash && (
        <div
          style={{
            position: "fixed",
            top: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            padding: "10px 20px",
            borderRadius: 100,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            background:
              igFlash.kind === "ok"
                ? "linear-gradient(135deg, var(--green), var(--green-700))"
                : "linear-gradient(135deg, var(--error), #b91c1c)",
            color: "#fff",
            maxWidth: 480,
            textAlign: "center",
          }}
        >
          {igFlash.text}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 420px)",
          gap: 16,
          padding: "16px 16px 16px 16px",
          height: "calc(100dvh - 65px)",
        }}
      >
        {/* Kanban — main */}
        <main
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 12px", gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-strong)" }}>
              Pipeline
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {company && (
                <span
                  title={`Quota mensal — reseta em ${new Date(company.quotas.resets_at).toLocaleDateString("pt-BR")}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: company.quotas.posts_remaining === 0 ? "var(--error)" : "var(--text-muted)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {company.quotas.posts_remaining} carrosséis restantes
                </span>
              )}
              <button
                onClick={() => setQuickFlowOpen(true)}
                disabled={!company || company.quotas.posts_remaining === 0}
                style={{
                  padding: "6px 14px",
                  borderRadius: 100,
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    !company || company.quotas.posts_remaining === 0
                      ? "var(--text-muted)"
                      : "linear-gradient(135deg, var(--green), var(--green-600))",
                  color: "#fff",
                  border: "none",
                  cursor:
                    !company || company.quotas.posts_remaining === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                ⚡ Quick Flow
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {!kanbanData ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
                <Spinner />
              </div>
            ) : (
              <KanbanBoard
                buckets={kanbanData.buckets}
                onSelectPost={(id) => setActivePostId(id)}
              />
            )}
          </div>
        </main>

        {/* Chat — sidebar */}
        <aside style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Glass
            style={{
              padding: 14,
              marginBottom: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Estilo visual
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {VISUAL_STYLE_OPTIONS.map((opt) => {
                const active = visualStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setVisualStyle(opt.value)}
                    style={{
                      background: active ? "var(--green-light)" : "rgba(255,255,255,0.5)",
                      border: active ? "1.5px solid var(--green-border)" : "1.5px solid var(--border)",
                      padding: "8px 10px",
                      borderRadius: 8,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: active ? "var(--green-700)" : "var(--text-strong)",
                      }}
                    >
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                      {opt.blurb}
                    </div>
                  </button>
                );
              })}
            </div>
          </Glass>

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
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {messagesToRender.map((m) => (
                <ChatBubble key={m.id} message={m} onClickPost={(id) => setActivePostId(id)} />
              ))}
              {send.isPending && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <AgentAvatar emoji={INSTA.emoji} gradient={INSTA.gradient} size={24} />
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
                placeholder="Tema do carrossel…"
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

      <PostDetailModal postId={activePostId} onClose={() => setActivePostId(null)} />

      <QuickFlowModal
        open={quickFlowOpen}
        onClose={() => setQuickFlowOpen(false)}
        onSelectPost={(id) => {
          setQuickFlowOpen(false);
          setActivePostId(id);
        }}
        maxCount={company?.quotas.posts_remaining ?? 0}
      />
    </div>
  );
}

function ChatBubble({
  message,
  onClickPost,
}: {
  message: InstaChatMessage;
  onClickPost: (id: string) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const postId = (message.metadata as { post_id?: string } | undefined)?.post_id;

  if (isSystem) {
    return (
      <div
        style={{
          padding: "8px 12px",
          background: "rgba(239,68,68,0.08)",
          color: "var(--error)",
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        {message.content}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      {!isUser && <AgentAvatar emoji={INSTA.emoji} gradient={INSTA.gradient} size={24} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "85%" }}>
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
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.content}
        </div>
        {postId && (
          <button
            onClick={() => onClickPost(postId)}
            style={{
              alignSelf: "flex-start",
              background: "var(--green-light)",
              color: "var(--green-700)",
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 100,
              border: "1px solid var(--green-border)",
            }}
          >
            Abrir post →
          </button>
        )}
      </div>
    </div>
  );
}
