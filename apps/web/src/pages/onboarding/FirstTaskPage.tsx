import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "../../components/ui/AgentAvatar";
import { CTA } from "../../components/ui/CTA";
import { Glass } from "../../components/ui/Glass";
import { Logo } from "../../components/ui/Logo";
import { CheckIcon, ChevronRightIcon } from "../../components/icons";
import { AGENT_VISUALS, type AgentSlug } from "../../lib/agent-visuals";

interface Suggestion {
  slug: AgentSlug;
  title: string;
  blurb: string;
  cta: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    slug: "insta-creator",
    title: "Crie seu primeiro carrossel",
    blurb: "InstaCreator vai te perguntar o tema e produzir copy + slides do zero.",
    cta: "Abrir InstaCreator",
  },
  {
    slug: "reels-creator",
    title: "Roteiro de Reel viral",
    blurb: "ReelsCreator gera ganchos, beats com timestamps e CTA pronto.",
    cta: "Abrir ReelsCreator",
  },
  {
    slug: "copy-master",
    title: "Email de venda em 1 minuto",
    blurb: "CopyMaster escreve email, copy de LP, WhatsApp e mais.",
    cta: "Abrir CopyMaster",
  },
];

export function FirstTaskPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        animation: "viewFadeIn 0.6s var(--easing-soft) both",
      }}
    >
      <header style={{ padding: "16px 24px" }}>
        <Logo size={32} showTag />
      </header>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 24px 64px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 100,
            background: "var(--green-light)",
            border: "1px solid var(--green-border)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--green-700)",
            letterSpacing: "0.05em",
            marginBottom: 20,
          }}
        >
          <CheckIcon size={14} strokeWidth={3} />
          MARCA CONFIGURADA
        </div>

        <h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 700, color: "var(--text-strong)", marginBottom: 12, lineHeight: 1.15 }}>
          Por onde quer começar?
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-subtle)", marginBottom: 36, maxWidth: 480, margin: "0 auto 36px" }}>
          Os agentes já conhecem sua marca. Escolhe o que vai criar primeiro — dá pra
          mudar a qualquer hora.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginBottom: 32,
            textAlign: "left",
          }}
        >
          {SUGGESTIONS.map((s, i) => {
            const visual = AGENT_VISUALS[s.slug];
            return (
              <Glass
                key={s.slug}
                style={{
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  cursor: "pointer",
                  transition: "transform 0.2s var(--easing-soft), box-shadow 0.2s var(--easing-soft)",
                  animation: `brainItemReveal 0.5s var(--easing-bounce) ${100 + i * 100}ms both`,
                }}
                onClick={() => navigate(`/agents/${s.slug}`)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <AgentAvatar slug={s.slug} size={48} />
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", marginBottom: 6 }}>
                    {s.title}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5 }}>
                    {s.blurb}
                  </p>
                </div>
                <span
                  style={{
                    color: visual.gradient[0],
                    fontSize: 13,
                    fontWeight: 700,
                    marginTop: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {s.cta}
                  <ChevronRightIcon size={14} />
                </span>
              </Glass>
            );
          })}
        </div>

        <CTA variant="secondary" onClick={() => navigate("/dashboard")}>
          Ver todos os agentes
        </CTA>
      </div>
    </div>
  );
}
