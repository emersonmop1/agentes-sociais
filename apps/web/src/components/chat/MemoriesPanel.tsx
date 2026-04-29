import { useMemo } from "react";
import { useMemories, useToggleMemory, useDeleteMemory, type Memory } from "../../hooks/useMemories";
import { Glass } from "../ui/Glass";
import { Spinner } from "../ui/Spinner";

const TYPE_LABEL: Record<Memory["memory_type"], string> = {
  correction: "Correções",
  pattern: "Padrões",
  preference: "Preferências",
  knowledge: "Conhecimento",
};

const TYPE_COLOR: Record<Memory["memory_type"], string> = {
  correction: "var(--error)",
  pattern: "var(--green)",
  preference: "var(--info)",
  knowledge: "var(--text-subtle)",
};

const SOURCE_LABEL: Record<Memory["source"], string> = {
  user_correction: "auto: correção",
  user_explicit: "explícito",
  agent_extracted: "auto: agente",
  manual: "manual",
  user_feedback: "feedback 👎/👍",
};

export function MemoriesPanel({ agentSlug }: { agentSlug: string }) {
  const { data, isLoading } = useMemories(agentSlug);
  const toggle = useToggleMemory(agentSlug);
  const del = useDeleteMemory(agentSlug);

  const grouped = useMemo(() => {
    const out: Record<Memory["memory_type"], Memory[]> = {
      correction: [],
      pattern: [],
      preference: [],
      knowledge: [],
    };
    for (const m of data?.memories ?? []) out[m.memory_type].push(m);
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spinner />
      </div>
    );
  }

  const total = data?.memories.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          O que aprendi
        </div>
        <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>
          {total === 0
            ? "Sem memórias ainda. Conversa, dá feedback 👍/👎 e o agente aprende."
            : `${total} memória${total === 1 ? "" : "s"} ativa${total === 1 ? "" : "s"}`}
        </div>
      </div>

      {(Object.keys(TYPE_LABEL) as Memory["memory_type"][]).map((type) => {
        const list = grouped[type];
        if (list.length === 0) return null;
        return (
          <div key={type}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: TYPE_COLOR[type],
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              {TYPE_LABEL[type]} ({list.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((m) => (
                <Glass key={m.id} style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.5, marginBottom: 6 }}>
                    {m.content}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    <span>{SOURCE_LABEL[m.source]}</span>
                    <span>·</span>
                    <span>p{m.priority}</span>
                    {m.times_used > 0 && (
                      <>
                        <span>·</span>
                        <span>{m.times_used} uso{m.times_used === 1 ? "" : "s"}</span>
                      </>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      onClick={() => toggle.mutate(m.id)}
                      title={m.is_active ? "Desativar" : "Ativar"}
                      style={{
                        background: "transparent",
                        color: m.is_active ? "var(--green-700)" : "var(--text-muted)",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      {m.is_active ? "ativa" : "inativa"}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Excluir esta memória?")) del.mutate(m.id);
                      }}
                      title="Excluir"
                      style={{ background: "transparent", color: "var(--text-muted)", padding: 0, fontSize: 14, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                </Glass>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
