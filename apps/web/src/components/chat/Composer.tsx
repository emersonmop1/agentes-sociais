import { useState, type FormEvent } from "react";
import { Glass } from "../ui/Glass";

export interface ComposerProps {
  disabled?: boolean;
  onSend: (text: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
}

export function Composer({ disabled, onSend, onAbort, isStreaming, placeholder }: ComposerProps) {
  const [text, setText] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  return (
    <Glass style={{ padding: 8, borderRadius: 24 }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as FormEvent);
            }
          }}
          placeholder={placeholder ?? "Manda sua mensagem…"}
          rows={1}
          disabled={disabled}
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            padding: "10px 14px",
            fontSize: 15,
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
            color: "var(--text-strong)",
            maxHeight: 200,
            minHeight: 24,
          }}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--error)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Parar"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
              <rect width="14" height="14" x="5" y="5" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || disabled}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background:
                text.trim() && !disabled
                  ? "linear-gradient(135deg, var(--green), var(--green-700))"
                  : "rgba(0,0,0,0.08)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Enviar"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </form>
    </Glass>
  );
}
