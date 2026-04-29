import { useSessions, useDeleteSession, type SessionSummary } from "../../hooks/useSessions";

export interface SessionsListProps {
  agentSlug: string;
  activeSessionId?: string;
  onSelect: (id: string | undefined) => void;
}

export function SessionsList({ agentSlug, activeSessionId, onSelect }: SessionsListProps) {
  const { data, isLoading } = useSessions(agentSlug);
  const del = useDeleteSession(agentSlug);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={() => onSelect(undefined)}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          background: !activeSessionId
            ? "linear-gradient(135deg, var(--green), var(--green-600))"
            : "transparent",
          color: !activeSessionId ? "#fff" : "var(--text-strong)",
          fontSize: 13,
          fontWeight: 600,
          textAlign: "left",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Nova conversa
      </button>

      {isLoading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 12px" }}>
          Carregando…
        </div>
      )}

      {data?.sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          active={s.id === activeSessionId}
          onSelect={() => onSelect(s.id)}
          onDelete={async () => {
            if (s.id === activeSessionId) onSelect(undefined);
            await del.mutateAsync(s.id);
          }}
        />
      ))}

      {data && data.sessions.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 12px" }}>
          Nenhuma conversa ainda
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: active ? "var(--green-light)" : "transparent",
        color: active ? "var(--green-700)" : "var(--text-strong)",
        cursor: "pointer",
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(0,0,0,0.03)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1,
          background: "transparent",
          color: "inherit",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          textAlign: "left",
          textOverflow: "ellipsis",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
        title={session.title ?? "Sem título"}
      >
        {session.title ?? "Sem título"}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm("Excluir esta conversa?")) onDelete();
        }}
        style={{
          background: "transparent",
          color: "var(--text-muted)",
          opacity: 0.6,
          padding: 4,
          borderRadius: 4,
          fontSize: 14,
          lineHeight: 1,
        }}
        title="Excluir"
      >
        ×
      </button>
    </div>
  );
}
