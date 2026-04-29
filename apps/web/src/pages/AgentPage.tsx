import { useNavigate, useParams } from "react-router-dom";
import { useAgents } from "../hooks/useAgents";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { CTA } from "../components/ui/CTA";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import type { ReactElement } from "react";
import { ChatWorkspacePage } from "./ChatWorkspacePage";
import { InstaWorkspacePage } from "./InstaWorkspacePage";
import { ReelsWorkspacePage } from "./ReelsWorkspacePage";
import { YouTubeWorkspacePage } from "./YouTubeWorkspacePage";

/** Agents that have a generic-chat workspace (no pipeline). */
const CHAT_AGENTS = new Set(["copy-master", "ad-master"]);
/** Agents that drive their own workspace. */
const PIPELINE_AGENTS: Record<string, () => ReactElement> = {
  "insta-creator": () => <InstaWorkspacePage />,
  "reels-creator": () => <ReelsWorkspacePage />,
  "youtube-growth": () => <YouTubeWorkspacePage />,
};

/**
 * Routing dispatcher for /agents/:slug. Splits between:
 *   • Chat-only agents (CopyMaster, AdMaster) → ChatWorkspacePage
 *   • Pipeline agents (InstaCreator, ReelsCreator, YouTubeGrowth) → coming-soon placeholder
 */
export function AgentPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useAgents();

  if (isLoading) {
    return <Centered><Spinner /></Centered>;
  }

  const agent = data?.agents.find((a) => a.slug === slug);
  if (!agent) {
    return (
      <Centered>
        <Glass style={{ padding: 24, maxWidth: 380, textAlign: "center" }}>
          <h2 style={{ marginBottom: 8 }}>Agente não encontrado</h2>
          <p style={{ fontSize: 14, color: "var(--text-subtle)", marginBottom: 16 }}>
            Slug "<code>{slug}</code>" não está no catálogo.
          </p>
          <CTA onClick={() => navigate("/dashboard")}>Voltar pro dashboard</CTA>
        </Glass>
      </Centered>
    );
  }

  if (CHAT_AGENTS.has(agent.slug)) {
    return <ChatWorkspacePage />;
  }
  const PipelineWorkspace = PIPELINE_AGENTS[agent.slug];
  if (PipelineWorkspace) {
    return <PipelineWorkspace />;
  }

  // Pipeline-based agents not yet implemented (Reels, YouTube)
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh" }}>
      <header
        style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Logo size={32} showTag />
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            background: "transparent",
            color: "var(--text-subtle)",
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 8,
          }}
        >
          ← Dashboard
        </button>
      </header>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <AgentAvatar emoji={agent.avatar_emoji} gradient={agent.gradient} size={64} />
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
              {agent.name}
            </h1>
            <p style={{ color: "var(--text-subtle)" }}>{agent.description}</p>
          </div>
        </div>

        <Glass style={{ padding: 24, marginTop: 24, textAlign: "center" }}>
          <h3 style={{ marginBottom: 8 }}>Em construção</h3>
          <p style={{ fontSize: 14, color: "var(--text-subtle)", lineHeight: 1.6 }}>
            Este agente roda numa próxima fatia do roadmap (pipeline com revisão
            humana etapa-a-etapa). Por enquanto, sua marca já está configurada e
            o brand context dela vai alimentar este agente quando ele subir.
          </p>
        </Glass>
      </div>
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
