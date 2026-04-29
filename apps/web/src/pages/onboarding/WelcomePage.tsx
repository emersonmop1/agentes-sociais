import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "../../components/ui/AgentAvatar";
import { CTA } from "../../components/ui/CTA";
import { Glass } from "../../components/ui/Glass";
import { Logo } from "../../components/ui/Logo";
import { StatusDot } from "../../components/ui/StatusDot";
import { ChevronRightIcon } from "../../components/icons";
import { AGENT_VISUALS, type AgentSlug } from "../../lib/agent-visuals";

/**
 * Featured stack for the hero "5 agentes verticais prontos" social proof.
 * Order matters: pink → purple → blue → amber → red, gradient hue rainbow.
 */
const FEATURED: AgentSlug[] = [
  "insta-creator",
  "reels-creator",
  "copy-master",
  "ad-master",
  "youtube-growth",
];

export function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        animation: "viewFadeIn 0.8s var(--easing-soft) both",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo size={48} showTag />
        </div>

        <Glass
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 18px",
            marginBottom: 28,
            borderRadius: 100,
          }}
        >
          <StatusDot kind="online" />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-subtle)" }}>
            Hub de agentes IA pra suas redes sociais
          </span>
        </Glass>

        <h1
          style={{
            fontSize: "clamp(34px, 6vw, 54px)",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-1.5px",
            color: "var(--text-strong)",
            marginBottom: 20,
          }}
        >
          Posts, copy e roteiros{" "}
          <span style={{ color: "var(--green)" }}>com a sua voz</span>
        </h1>

        <p
          style={{
            fontSize: 17,
            color: "var(--text-subtle)",
            lineHeight: 1.6,
            marginBottom: 36,
            maxWidth: 540,
            margin: "0 auto 36px",
          }}
        >
          Cinco agentes especializados em redes sociais e copywriting. Treinados na
          sua marca, prontos pra produzir em minutos.
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <CTA onClick={() => navigate("/login")}>
            Começar agora <ChevronRightIcon size={16} />
          </CTA>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
            marginTop: 32,
          }}
        >
          <div style={{ display: "flex" }}>
            {FEATURED.map((slug, i) => {
              const visual = AGENT_VISUALS[slug];
              return (
                <div
                  key={slug}
                  title={visual.label}
                  style={{
                    marginLeft: i > 0 ? -10 : 0,
                    zIndex: FEATURED.length - i,
                    border: "2px solid rgba(255,255,255,0.7)",
                    borderRadius: "32%",
                    animation: `fadeIn 0.5s var(--easing-soft) ${100 + i * 80}ms both`,
                  }}
                >
                  <AgentAvatar slug={slug} size={40} />
                </div>
              );
            })}
          </div>
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
            5 agentes verticais prontos
          </span>
        </div>
      </div>
    </div>
  );
}
