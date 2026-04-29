import { useState } from "react";
import { AgentAvatar } from "../ui/AgentAvatar";
import { Glass } from "../ui/Glass";
import { TypingDots } from "../ui/TypingDots";
import { useFeedback } from "../../hooks/useMemories";
import type { ChatMessage } from "../../hooks/useChat";

export interface MessageRowProps {
  message: ChatMessage;
  agentSlug: string;
  agentEmoji: string;
  agentGradient: readonly [string, string];
}

export function MessageRow({ message, agentSlug, agentEmoji, agentGradient }: MessageRowProps) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming === true;
  const feedback = useFeedback(agentSlug);
  const [feedbackSent, setFeedbackSent] = useState<"up" | "down" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");
  const tempId = !message.id || message.id.startsWith("tmp-");

  const handleFeedback = async (positive: boolean, comment?: string) => {
    if (tempId || feedbackSent || feedback.isPending) return;
    try {
      await feedback.mutateAsync({
        messageId: message.id,
        isPositive: positive,
        comment,
      });
      setFeedbackSent(positive ? "up" : "down");
      setFeedbackOpen(false);
    } catch {
      // ignore — surface in UI later
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      {!isUser && (
        <AgentAvatar emoji={agentEmoji} gradient={agentGradient} size={36} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "82%", flex: 1 }}>
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 18,
            background: isUser
              ? "linear-gradient(135deg, var(--green), var(--green-600))"
              : "var(--surface-glass)",
            color: isUser ? "#fff" : "var(--text-strong)",
            border: isUser ? "none" : "1px solid var(--surface-glass-border)",
            backdropFilter: isUser ? "none" : "blur(16px)",
            boxShadow: isUser
              ? "0 4px 16px rgba(34,197,94,0.2)"
              : "var(--surface-glass-shadow)",
            fontSize: 15,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            alignSelf: isUser ? "flex-end" : "flex-start",
            minWidth: isStreaming ? 60 : "auto",
          }}
        >
          {message.content || (isStreaming ? <TypingDots /> : null)}
        </div>

        {/* Feedback row — only for non-temp assistant messages */}
        {!isUser && !tempId && !isStreaming && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
            <FeedbackButton
              direction="up"
              active={feedbackSent === "up"}
              onClick={() => handleFeedback(true)}
              disabled={Boolean(feedbackSent) || feedback.isPending}
            />
            <FeedbackButton
              direction="down"
              active={feedbackSent === "down"}
              onClick={() => setFeedbackOpen(true)}
              disabled={Boolean(feedbackSent) || feedback.isPending}
            />
            {feedbackSent && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Aprendi com seu feedback
              </span>
            )}
          </div>
        )}

        {feedbackOpen && !feedbackSent && (
          <Glass style={{ padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 13, color: "var(--text-strong)", marginBottom: 8 }}>
              O que ficou ruim? (opcional)
            </div>
            <textarea
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="Ex: prefiro headlines com número específico"
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(255,255,255,0.7)",
                outline: "none",
                resize: "vertical",
                minHeight: 50,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button
                onClick={() => {
                  setFeedbackOpen(false);
                  setFeedbackComment("");
                }}
                style={{ background: "transparent", color: "var(--text-subtle)", fontSize: 12, fontWeight: 600 }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleFeedback(false, feedbackComment || undefined)}
                style={{
                  background: "var(--error)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 14px",
                  borderRadius: 100,
                }}
              >
                Enviar feedback
              </button>
            </div>
          </Glass>
        )}
      </div>
    </div>
  );
}

function FeedbackButton({
  direction,
  active,
  onClick,
  disabled,
}: {
  direction: "up" | "down";
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={direction === "up" ? "Bom" : "Ruim"}
      style={{
        background: active ? (direction === "up" ? "var(--green-light)" : "rgba(239,68,68,0.1)") : "transparent",
        color: active ? (direction === "up" ? "var(--green-700)" : "var(--error)") : "var(--text-muted)",
        padding: 4,
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {direction === "up" ? (
          <path d="M7 10v12M15 5.88l-1 4.12h6.24a2 2 0 0 1 1.92 2.56l-2.4 8A2 2 0 0 1 17.83 22H7m8-16V4a2 2 0 0 0-2-2h-.5L7 10v12h11.83a2 2 0 0 0 1.92-1.44l2.4-8A2 2 0 0 0 21.24 10H15z" />
        ) : (
          <path d="M17 14V2M9 18.12l1-4.12H3.76a2 2 0 0 1-1.92-2.56l2.4-8A2 2 0 0 1 6.17 2H17m-8 16v2a2 2 0 0 0 2 2h.5L17 14V2H6.17a2 2 0 0 0-1.92 1.44l-2.4 8A2 2 0 0 0 3.76 14H9z" />
        )}
      </svg>
    </button>
  );
}
