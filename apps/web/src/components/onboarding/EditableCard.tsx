import { useState, type ReactNode } from "react";
import { CTA } from "../ui/CTA";
import { Glass } from "../ui/Glass";

export interface EditableCardProps {
  title: string;
  /** Renderable icon — pass <CameraIcon /> or any node. */
  icon: ReactNode;
  children: ReactNode;
  onSave: () => Promise<void> | void;
  /** Render a stable, read-only summary. */
  summary: ReactNode;
  /** Optional badge/state on the right of the title. */
  badge?: ReactNode;
}

export function EditableCard({ title, icon, children, summary, onSave, badge }: EditableCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Glass style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: "var(--green-light)",
              color: "var(--green-700)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </span>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-strong)",
              margin: 0,
            }}
          >
            {title}
          </h3>
          {badge}
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            style={{
              background: "transparent",
              color: "var(--green-700)",
              fontSize: 13,
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: 8,
            }}
          >
            Editar
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              style={{
                background: "transparent",
                color: "var(--text-subtle)",
                fontSize: 13,
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: 8,
              }}
            >
              Cancelar
            </button>
            <CTA
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "6px 14px", minHeight: 32, fontSize: 13 }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </CTA>
          </div>
        )}
      </div>
      <div>{editing ? children : summary}</div>
    </Glass>
  );
}

export const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  minHeight: 40,
  borderRadius: 10,
  border: "1.5px solid rgba(0,0,0,0.08)",
  fontSize: 15,
  color: "var(--text-strong)",
  background: "rgba(255,255,255,0.7)",
  outline: "none",
  fontFamily: "inherit",
} as const;
