import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { CheckIcon } from "../components/icons";
import { useAuth } from "../contexts/AuthContext";
import {
  useAcceptInvite,
  useInvitePreview,
  type InvitePreview,
} from "../hooks/useInvites";

/**
 * /invite/:token route. Three states:
 *
 *   1. Auth not loaded → spinner
 *   2. Not signed in   → "Entre com X@Y.com pra aceitar este convite" + login CTA
 *      that returns to this page after sign-in
 *   3. Signed in       → preview details + Accept button (or error if email
 *      doesn't match the invite, status != pending, expired, etc.)
 */
export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // When the user lands here after signing in, kick them straight to /dashboard
  // once accept succeeds.
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
      return () => clearTimeout(t);
    }
    return;
  }, [done, navigate]);

  if (authLoading) {
    return <PageShell><Spinner /></PageShell>;
  }

  if (preview.isLoading) {
    return <PageShell><Spinner /></PageShell>;
  }

  if (preview.isError || !preview.data) {
    return (
      <PageShell>
        <Card title="Convite não encontrado">
          <p style={{ fontSize: 13, color: "var(--text-strong)" }}>
            Este link de convite não existe ou foi removido. Peça pro owner um
            link novo.
          </p>
        </Card>
      </PageShell>
    );
  }

  const inv = preview.data;

  if (inv.status !== "pending") {
    return (
      <PageShell>
        <Card title="Convite indisponível">
          <p style={{ fontSize: 13, color: "var(--text-strong)" }}>
            {inv.status === "accepted"
              ? "Este convite já foi aceito."
              : inv.status === "revoked"
                ? "Este convite foi revogado."
                : "Este convite expirou. Peça pro owner um link novo."}
          </p>
        </Card>
      </PageShell>
    );
  }

  // Not signed in — push to /login with returnTo so they come back here
  if (!session) {
    return (
      <PageShell>
        <InvitePreviewCard inv={inv} />
        <Card>
          <p style={{ fontSize: 13, color: "var(--text-strong)", marginBottom: 12 }}>
            Pra aceitar, entre com <strong>{inv.email}</strong>.
          </p>
          <button
            onClick={() => {
              const returnTo = encodeURIComponent(`/invite/${token}`);
              navigate(`/login?returnTo=${returnTo}`);
            }}
            style={{
              padding: "10px 22px",
              borderRadius: 100,
              background: "linear-gradient(135deg, var(--green), var(--green-600))",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
            }}
          >
            Entrar
          </button>
        </Card>
      </PageShell>
    );
  }

  // Signed in — check email matches, show accept CTA
  const userEmail = session.user.email?.toLowerCase().trim() ?? "";
  if (userEmail !== inv.email.toLowerCase().trim()) {
    return (
      <PageShell>
        <InvitePreviewCard inv={inv} />
        <Card title="Email diferente">
          <p style={{ fontSize: 13, color: "var(--text-strong)" }}>
            Você está logado como <strong>{userEmail}</strong>, mas este convite
            foi emitido para <strong>{inv.email}</strong>. Faça logout e entre
            com a conta certa.
          </p>
        </Card>
      </PageShell>
    );
  }

  if (done) {
    return (
      <PageShell>
        <Card>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 18,
              fontWeight: 700,
              color: "var(--green-700)",
              marginBottom: 12,
            }}
          >
            <CheckIcon size={20} strokeWidth={3} />
            Bem-vindo
          </div>
          <p style={{ fontSize: 13, color: "var(--text-strong)" }}>
            Você agora faz parte da empresa. Redirecionando…
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <InvitePreviewCard inv={inv} />
      <Card>
        {error && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              fontSize: 12,
              color: "#b91c1c",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <button
          onClick={async () => {
            setError(null);
            try {
              await accept.mutateAsync(token!);
              setDone(true);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          disabled={accept.isPending}
          style={{
            padding: "12px 28px",
            borderRadius: 100,
            background: accept.isPending
              ? "var(--text-muted)"
              : "linear-gradient(135deg, var(--green), var(--green-600))",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            border: "none",
            cursor: accept.isPending ? "not-allowed" : "pointer",
          }}
        >
          {accept.isPending ? "Aceitando…" : `Aceitar como ${inv.role}`}
        </button>
      </Card>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
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
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: "1px solid var(--border)",
          background: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(12px)",
        }}
      >
        <button onClick={() => navigate("/welcome")} style={{ background: "transparent", padding: 0 }}>
          <Logo size={28} showTag />
        </button>
      </header>
      <main
        style={{
          maxWidth: 540,
          margin: "0 auto",
          padding: "48px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {children}
      </main>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Glass style={{ padding: 24 }}>
      {title && (
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text-h)",
            marginBottom: 12,
          }}
        >
          {title}
        </h2>
      )}
      {children}
    </Glass>
  );
}

function InvitePreviewCard({ inv }: { inv: InvitePreview }) {
  return (
    <Glass
      style={{
        padding: 22,
        background: "var(--green-light)",
        border: "1px solid var(--green-border)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--green-700)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Você foi convidado
      </div>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "var(--text-h)",
          marginBottom: 6,
          letterSpacing: "-0.02em",
        }}
      >
        {inv.company_name ?? "(empresa)"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.55 }}>
        Como <strong>{inv.role}</strong>. Convite para{" "}
        <strong>{inv.email}</strong>, expira em{" "}
        {new Date(inv.expires_at).toLocaleDateString("pt-BR")}.
      </p>
    </Glass>
  );
}
