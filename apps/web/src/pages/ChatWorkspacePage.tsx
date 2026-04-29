import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Composer } from "../components/chat/Composer";
import { MemoriesPanel } from "../components/chat/MemoriesPanel";
import { MessageRow } from "../components/chat/MessageRow";
import { SessionsList } from "../components/chat/SessionsList";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { useAgents } from "../hooks/useAgents";
import { useChat } from "../hooks/useChat";

const QUICK_ACTIONS: Record<string, { label: string; prompt: string }[]> = {
  "copy-master": [
    {
      label: "Email de venda",
      prompt:
        "Escreve uma sequência de 3 emails de venda pra meu produto. Antes pergunta o que precisa: produto, oferta, preço, público.",
    },
    {
      label: "Headlines A/B",
      prompt:
        "Me dá 5 headlines pra teste A/B do meu anúncio principal. Pergunta o que precisa pra fazer bem.",
    },
    {
      label: "Copy de LP",
      prompt:
        "Vou criar uma landing page nova. Te conta o produto e você me entrega: hero, problema, solução, prova, oferta e CTA.",
    },
    {
      label: "WhatsApp lançamento",
      prompt:
        "Escreve uma sequência de 5 mensagens de WhatsApp pra um lançamento. Pergunta o que precisa antes.",
    },
  ],
  "ad-master": [
    {
      label: "3 ângulos pra Meta Ads",
      prompt:
        "Quero 3 variações de ângulo pra Meta Ads. Antes me pergunta o que precisa saber (oferta, audiência, landing).",
    },
    {
      label: "Google Search RSA",
      prompt:
        "Me entrega 15 headlines + 4 descriptions pra Google Search Ads. Pergunta o produto e public-alvo.",
    },
    {
      label: "Script de Reels (30s)",
      prompt:
        "Me escreve script de 30s pra Reels. Pergunta o que precisa antes (oferta, dor, CTA).",
    },
    {
      label: "Funil TOFU→BOFU",
      prompt:
        "Quero estruturar funil de ads do zero. Pergunta o que precisa pra cada estágio (TOFU, MOFU, BOFU).",
    },
  ],
};

export function ChatWorkspacePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<"chat" | "memories">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: agents, isLoading: agentsLoading } = useAgents();
  const agent = agents?.agents.find((a) => a.slug === slug);

  const { messages, isStreaming, send, abort, error, reset } = useChat({
    agentSlug: slug ?? "",
    sessionId: activeSessionId,
    onSessionCreated: (id) => setActiveSessionId(id),
  });

  // Auto-scroll on new messages / streaming chunks
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (agentsLoading) {
    return <Centered><Spinner /></Centered>;
  }

  if (!agent) {
    return (
      <Centered>
        <Glass style={{ padding: 24, textAlign: "center" }}>
          <h2 style={{ marginBottom: 8 }}>Agente não encontrado</h2>
          <button
            onClick={() => navigate("/dashboard")}
            style={{ background: "var(--green)", color: "#fff", padding: "10px 20px", borderRadius: 100, fontWeight: 600 }}
          >
            Dashboard
          </button>
        </Glass>
      </Centered>
    );
  }

  const handleSelectSession = (id: string | undefined) => {
    setActiveSessionId(id);
    if (id === undefined) reset();
  };

  const quickActions = QUICK_ACTIONS[slug ?? ""] ?? [];

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        display: "grid",
        gridTemplateColumns: sidebarOpen ? "260px 1fr" : "0 1fr",
        transition: "grid-template-columns 0.25s ease",
      }}
    >
      {/* Sidebar */}
      {sidebarOpen && (
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            background: "rgba(255,255,255,0.4)",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
            height: "100dvh",
            position: "sticky",
            top: 0,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <button onClick={() => navigate("/dashboard")} style={{ background: "transparent", padding: 0 }}>
              <Logo size={28} />
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{ background: "transparent", color: "var(--text-muted)", padding: 4 }}
              title="Recolher"
            >
              ‹
            </button>
          </div>

          <div style={{ padding: 12 }}>
            <SessionsList
              agentSlug={agent.slug}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
            />
          </div>
        </aside>
      )}

      {/* Main */}
      <main style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
        {/* Header */}
        <header
          style={{
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,255,255,0.4)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                style={{ background: "transparent", color: "var(--text-muted)", padding: 4 }}
                title="Abrir"
              >
                ›
              </button>
            )}
            <AgentAvatar emoji={agent.avatar_emoji} gradient={agent.gradient} size={36} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-strong)" }}>
                {agent.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {agent.description}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Tab active={tab === "chat"} onClick={() => setTab("chat")}>Chat</Tab>
            <Tab active={tab === "memories"} onClick={() => setTab("memories")}>Memórias</Tab>
          </div>
        </header>

        {/* Body — chat or memories */}
        {tab === "chat" ? (
          <>
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              {messages.length === 0 ? (
                <EmptyState
                  agentName={agent.name}
                  agentEmoji={agent.avatar_emoji}
                  gradient={agent.gradient}
                  quickActions={quickActions}
                  onPickQuickAction={(prompt) => send(prompt)}
                />
              ) : (
                messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    agentSlug={agent.slug}
                    agentEmoji={agent.avatar_emoji}
                    agentGradient={agent.gradient}
                  />
                ))
              )}
              {error && (
                <Glass
                  style={{
                    padding: "10px 14px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "var(--error)",
                    fontSize: 13,
                  }}
                >
                  {error}
                </Glass>
              )}
            </div>

            <div style={{ padding: "16px 32px 24px" }}>
              <Composer
                disabled={isStreaming}
                onSend={send}
                onAbort={abort}
                isStreaming={isStreaming}
                placeholder={`Escreve pra ${agent.name}…`}
              />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              <MemoriesPanel agentSlug={agent.slug} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        background: active ? "var(--green-light)" : "transparent",
        color: active ? "var(--green-700)" : "var(--text-subtle)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({
  agentName,
  agentEmoji,
  gradient,
  quickActions,
  onPickQuickAction,
}: {
  agentName: string;
  agentEmoji: string;
  gradient: readonly [string, string];
  quickActions: { label: string; prompt: string }[];
  onPickQuickAction: (prompt: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 16,
        padding: 48,
      }}
    >
      <AgentAvatar emoji={agentEmoji} gradient={gradient} size={64} />
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 6 }}>
          Conversa com {agentName}
        </h2>
        <p style={{ color: "var(--text-subtle)", fontSize: 14, maxWidth: 420 }}>
          Já estou treinada na voz da sua marca. Conta o que você precisa.
        </p>
      </div>

      {quickActions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 10,
            maxWidth: 540,
            width: "100%",
            marginTop: 16,
          }}
        >
          {quickActions.map((qa) => (
            <button
              key={qa.label}
              onClick={() => onPickQuickAction(qa.prompt)}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                background: "var(--surface-glass)",
                border: "1px solid var(--surface-glass-border)",
                backdropFilter: "blur(16px)",
                color: "var(--text-strong)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--green-light)";
                e.currentTarget.style.borderColor = "var(--green-border)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface-glass)";
                e.currentTarget.style.borderColor = "var(--surface-glass-border)";
              }}
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
      {children}
    </div>
  );
}
