import type { ReactElement } from "react";
import { useCompany } from "../../hooks/useCompany";

type QuotaKind = "posts" | "reels" | "youtube" | "chat";

const LABEL: Record<QuotaKind, string> = {
  posts: "carrosséis",
  reels: "Reels",
  youtube: "vídeos",
  chat: "chats",
};

const FIELD: Record<QuotaKind, "posts_remaining" | "reels_remaining" | "youtube_remaining" | "chat_remaining"> = {
  posts: "posts_remaining",
  reels: "reels_remaining",
  youtube: "youtube_remaining",
  chat: "chat_remaining",
};

/**
 * Compact quota counter pill — placed in workspace headers and the dashboard.
 * Hidden until the company snapshot loads to avoid flicker.
 */
export function QuotaBadge({ kind }: { kind: QuotaKind }): ReactElement | null {
  const { data } = useCompany();
  if (!data) return null;
  const remaining = data.quotas[FIELD[kind]];
  const exhausted = remaining === 0;
  return (
    <span
      title={`Reseta em ${new Date(data.quotas.resets_at).toLocaleDateString("pt-BR")}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: exhausted ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
        color: exhausted ? "var(--error)" : "var(--green-700)",
        border: `1px solid ${exhausted ? "rgba(239, 68, 68, 0.3)" : "var(--green-border)"}`,
      }}
    >
      {remaining} {LABEL[kind]}
    </span>
  );
}
