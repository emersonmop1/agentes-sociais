import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useAgents } from "../hooks/useAgents";
import { useOnboardingState } from "../hooks/useOnboarding";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { StatusDot } from "../components/ui/StatusDot";
import { ChevronRightIcon } from "../components/icons";

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { data: state } = useOnboardingState();
  const { data: agentList, isLoading } = useAgents();

  // BrandBot is an internal onboarding agent; hide from the dashboard grid.
  const visibleAgents = (agentList?.agents ?? []).filter(
    (a) => a.category !== "onboarding",
  );

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        animation: "viewFadeIn 0.5s var(--easing-soft) both",
      }}
    >
      <header
        style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          background: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(12px) saturate(180%)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Logo size={32} showTag />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Glass
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-subtle)",
            }}
          >
            <StatusDot kind="online" />
            {state?.company_name ?? user?.email}
          </Glass>
          <button
            onClick={() => navigate("/settings")}
            style={{
              background: "transparent",
              color: "var(--text-subtle)",
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 8,
            }}
          >
            Configurações
          </button>
          <button
            onClick={() => signOut()}
            style={{
              background: "transparent",
              color: "var(--text-subtle)",
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 8,
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>
          Olá, {user?.user_metadata?.display_name ?? user?.email?.split("@")[0]}
        </h1>
        <p style={{ color: "var(--text-subtle)", marginBottom: 32 }}>
          Cinco agentes prontos pra produzir com a voz da sua marca.
        </p>

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <Spinner />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {visibleAgents.map((a, i) => (
              <Glass
                key={a.slug}
                onClick={() => navigate(`/agents/${a.slug}`)}
                style={{
                  padding: 20,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  transition: "transform 0.2s var(--easing-soft), box-shadow 0.2s var(--easing-soft)",
                  animation: `brainItemReveal 0.5s var(--easing-bounce) ${80 + i * 70}ms both`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = "var(--surface-glass-shadow)";
                }}
              >
                <AgentAvatar slug={a.slug} gradient={a.gradient} size={56} />
                <div>
                  <h3
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: "var(--text-strong)",
                      marginBottom: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {a.name}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5 }}>
                    {a.description}
                  </p>
                </div>
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    fontWeight: 700,
                    marginTop: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Abrir
                  <ChevronRightIcon size={12} />
                </span>
              </Glass>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
