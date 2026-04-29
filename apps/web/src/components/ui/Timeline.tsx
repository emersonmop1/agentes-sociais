/**
 * Generic timeline renderer for agent activity. Shared between
 * PostDetailModal (insta-creator) and YouTube project detail.
 *
 * Each event has a kind tag, a relative timestamp, and a one-line summary.
 * Click an event to expand the raw JSON for debugging.
 */

import { useState, type ReactElement } from "react";
import type { TimelineEvent } from "../../hooks/useTimeline";

const KIND_ICON: Record<string, string> = {
  chat_message: "💬",
  agent_execution: "🤖",
  render_job: "🎨",
  publish_job: "📤",
  thumbnail_job: "🖼️",
  studio_job: "📌",
};

const KIND_COLOR: Record<string, string> = {
  chat_message: "var(--text-strong)",
  agent_execution: "#7c3aed",
  render_job: "#0ea5e9",
  publish_job: "var(--green-700)",
  thumbnail_job: "#f59e0b",
  studio_job: "#ef4444",
};

export function Timeline({
  events,
  emptyText = "Nenhum evento ainda.",
}: {
  events: TimelineEvent[];
  emptyText?: string;
}): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events.map((ev) => {
        const isOpen = expanded === ev.id;
        return (
          <div
            key={`${ev.kind}-${ev.id}`}
            style={{
              borderLeft: `2px solid ${KIND_COLOR[ev.kind] ?? "var(--text-muted)"}`,
              paddingLeft: 10,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : ev.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-strong)", textAlign: "left" }}>
                <span style={{ marginRight: 6 }}>{KIND_ICON[ev.kind] ?? "•"}</span>
                <strong style={{ color: KIND_COLOR[ev.kind] ?? "inherit" }}>
                  {summary(ev)}
                </strong>
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {formatRelativeTime(ev.at_ts)}
              </span>
            </button>
            {isOpen && (
              <pre
                style={{
                  margin: "6px 0 0",
                  padding: 8,
                  background: "rgba(15,23,42,0.04)",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  maxHeight: 240,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(ev.data, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function summary(ev: TimelineEvent): string {
  const d = ev.data;
  switch (ev.kind) {
    case "chat_message": {
      const role = String(d.role ?? "?");
      const content = String(d.content ?? "");
      return `${role === "user" ? "Você" : role === "assistant" ? "Agente" : role}: ${truncate(content, 80)}`;
    }
    case "agent_execution": {
      const ms = typeof d.latency_ms === "number" ? `${(d.latency_ms / 1000).toFixed(1)}s` : "?";
      const tin = d.tokens_input ?? "?";
      const tout = d.tokens_output ?? "?";
      const status = d.status === "error" ? " ⚠" : "";
      return `${d.model ?? "LLM"} · ${ms} · ${tin}→${tout} tk${status}`;
    }
    case "render_job": {
      const idxs = Array.isArray(d.slide_indexes) ? d.slide_indexes : [];
      const which = idxs.length === 0 ? "todos slides" : `slides ${(idxs as number[]).join(",")}`;
      return `Render ${which} · ${d.status}`;
    }
    case "publish_job":
      return `Publish · ${d.status}${d.attempts && Number(d.attempts) > 1 ? ` (tentativa ${d.attempts})` : ""}`;
    case "thumbnail_job":
      return `Gerando thumbnail · ${d.status}`;
    case "studio_job":
      return `Studio (${d.kind}) · ${d.status}`;
    default:
      return ev.kind;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "agora";
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m atrás`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / 3_600_000)}h atrás`;
  return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
