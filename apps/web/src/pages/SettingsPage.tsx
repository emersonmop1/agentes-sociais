import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { Spinner } from "../components/ui/Spinner";
import { StatusDot } from "../components/ui/StatusDot";
import { useCompany } from "../hooks/useCompany";
import {
  useCreateInvite,
  useInvitesList,
  useRevokeInvite,
  type InviteRole,
  type InviteSummary,
} from "../hooks/useInvites";
import { useMe } from "../hooks/useMe";

export function SettingsPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: company } = useCompany();
  const isOwner = me?.company.role === "owner";

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
        <button
          onClick={() => navigate("/dashboard")}
          style={{ background: "transparent", padding: 0 }}
        >
          <Logo size={28} showTag />
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>
          Configurações
        </div>
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

      <main
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Company info card */}
        <Glass style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Empresa
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--text-h)",
              marginBottom: 4,
            }}
          >
            {company?.name ?? "—"}
          </h1>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--text-subtle)",
            }}
          >
            <StatusDot kind={company?.plan === "pro" ? "info" : "online"} static />
            Plano: <strong>{company?.plan ?? "—"}</strong> · Seu papel:{" "}
            <strong>{me?.company.role ?? "—"}</strong>
          </div>
        </Glass>

        {/* Team section — owner-only */}
        {isOwner ? (
          <TeamSection />
        ) : (
          <Glass style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Equipe
            </div>
            <p style={{ fontSize: 13, color: "var(--text-strong)" }}>
              Apenas owners podem gerenciar convites. Peça pro owner da empresa
              te dar acesso de admin se precisar.
            </p>
          </Glass>
        )}
      </main>
    </div>
  );
}

function TeamSection() {
  const { data, isLoading } = useInvitesList();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLastUrl(null);
    if (!email.trim()) return;
    try {
      const r = await create.mutateAsync({ email: email.trim(), role });
      setLastUrl(r.invite_url);
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Glass style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Equipe
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 140px auto",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@empresa.com"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 14,
          }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as InviteRole)}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 14,
            background: "#fff",
          }}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={create.isPending}
          style={{
            padding: "10px 22px",
            borderRadius: 100,
            background: create.isPending
              ? "var(--text-muted)"
              : "linear-gradient(135deg, var(--green), var(--green-600))",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: create.isPending ? "not-allowed" : "pointer",
          }}
        >
          {create.isPending ? "Enviando…" : "Convidar"}
        </button>
      </form>

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

      {lastUrl && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--green-light)",
            border: "1px solid var(--green-border)",
            fontSize: 12,
            color: "var(--text-strong)",
            marginBottom: 14,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Convite criado — copie o link e mande pra essa pessoa:
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                flex: 1,
                padding: "6px 8px",
                background: "rgba(255,255,255,0.6)",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {lastUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(lastUrl).catch(() => undefined)}
              style={{
                padding: "6px 12px",
                borderRadius: 100,
                background: "var(--green-700)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner />
        </div>
      ) : (data?.invites.length ?? 0) === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
          Nenhum convite ainda.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data!.invites.map((inv) => (
            <InviteRow
              key={inv.id}
              invite={inv}
              onRevoke={() => revoke.mutate(inv.id)}
              revoking={revoke.isPending}
            />
          ))}
        </div>
      )}
    </Glass>
  );
}

function InviteRow({
  invite,
  onRevoke,
  revoking,
}: {
  invite: InviteSummary;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const expired =
    invite.status === "pending" && new Date(invite.expires_at).getTime() < Date.now();
  const status = expired ? "expired" : invite.status;
  const color: Record<string, string> = {
    pending: "var(--text-strong)",
    accepted: "var(--green-700)",
    revoked: "var(--text-muted)",
    expired: "#b91c1c",
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.5)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-strong)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {invite.email}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {invite.role}
          {" · "}
          <span style={{ color: color[status] ?? "var(--text-muted)", fontWeight: 600 }}>
            {labelStatus(status)}
          </span>
          {invite.status === "pending" && (
            <>
              {" · expira em "}
              {new Date(invite.expires_at).toLocaleDateString("pt-BR")}
            </>
          )}
        </div>
      </div>
      {invite.status === "pending" && (
        <button
          onClick={onRevoke}
          disabled={revoking}
          style={{
            padding: "6px 10px",
            borderRadius: 100,
            background: "transparent",
            border: "1px solid var(--border)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            cursor: revoking ? "not-allowed" : "pointer",
          }}
        >
          Revogar
        </button>
      )}
    </div>
  );
}

function labelStatus(s: string): string {
  switch (s) {
    case "pending":
      return "pendente";
    case "accepted":
      return "aceito";
    case "revoked":
      return "revogado";
    case "expired":
      return "expirado";
    default:
      return s;
  }
}
