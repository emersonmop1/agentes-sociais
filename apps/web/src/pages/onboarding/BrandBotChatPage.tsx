import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { DraftPreview } from "../../components/onboarding/DraftPreview";
import { AgentAvatar } from "../../components/ui/AgentAvatar";
import { CTA } from "../../components/ui/CTA";
import { Glass } from "../../components/ui/Glass";
import { Logo } from "../../components/ui/Logo";
import { Spinner } from "../../components/ui/Spinner";
import { StatusDot } from "../../components/ui/StatusDot";
import { TypeWriter } from "../../components/ui/TypeWriter";
import { TypingDots } from "../../components/ui/TypingDots";
import {
  CheckIcon,
  ChevronRightIcon,
  PaperclipIcon,
  SendIcon,
} from "../../components/icons";
import {
  useOnboardingState,
  useSendOnboardingMessage,
  useUploadLogo,
  type OnboardingMessage,
} from "../../hooks/useOnboarding";

const OPENING_MESSAGE: OnboardingMessage = {
  id: "opener",
  role: "assistant",
  content:
    "Oi! Sou a BrandBot. Vou conhecer sua marca em 2 minutos pra os outros agentes já saírem produzindo do seu jeito. Me conta rapidão: o que você faz e pra quem?",
  created_at: new Date().toISOString(),
};

export function BrandBotChatPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useOnboardingState();
  const sendMessage = useSendOnboardingMessage();
  const uploadLogo = useUploadLogo();
  const [draftInput, setDraftInput] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploadError(null);
    if (!file.type.startsWith("image/")) {
      setUploadError("Manda uma imagem (PNG, JPG, SVG, WEBP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("Arquivo grande demais (limite 8 MB).");
      return;
    }
    try {
      await uploadLogo.mutateAsync(file);
    } catch (err) {
      setUploadError((err as Error).message);
    }
  };

  // Auto-redirect once onboarding is complete (e.g. user already finished in another tab)
  useEffect(() => {
    if (data?.onboarding_completed) navigate("/dashboard", { replace: true });
  }, [data?.onboarding_completed, navigate]);

  // Server-driven auto-advance: once `ready_to_finish` is true, the BrandBot's
  // role is done. Gemini sometimes refuses to emit the [ONBOARDING_READY]
  // sentinel and loops "missão completa" replies indefinitely — so we don't
  // depend on the LLM. After a short delay the user is taken to /onboarding/
  // reveal regardless. The delay gives them time to read the final reply and
  // optional cancel via navigation back.
  const [autoAdvanceCancelled, setAutoAdvanceCancelled] = useState(false);
  useEffect(() => {
    if (!data?.ready_to_finish) return;
    if (autoAdvanceCancelled) return;
    if (sendMessage.isPending) return; // wait for the in-flight reply to land
    const t = setTimeout(() => {
      navigate("/onboarding/reveal");
    }, 2200);
    return () => clearTimeout(t);
  }, [
    data?.ready_to_finish,
    autoAdvanceCancelled,
    sendMessage.isPending,
    navigate,
  ]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [data?.messages?.length, sendMessage.isPending]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draftInput.trim();
    if (!text || sendMessage.isPending) return;
    setDraftInput("");
    try {
      await sendMessage.mutateAsync(text);
    } catch (err) {
      console.error("send failed", err);
    }
  };

  if (isLoading || !data) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
        }}
      >
        <Spinner />
      </div>
    );
  }

  // The opener is shown only when there are no real messages yet — once the
  // user replies, the opener is part of conversation memory anyway.
  const hasRealMessages = data.messages.length > 0;
  const messagesToRender: OnboardingMessage[] = hasRealMessages
    ? data.messages
    : [OPENING_MESSAGE];

  // Index of the latest assistant message — that one gets the TypeWriter.
  // Older assistant messages are static text. We compute by walking backwards
  // so we don't reanimate when the user appends a new user message in between.
  const lastAssistantIdx = (() => {
    for (let i = messagesToRender.length - 1; i >= 0; i -= 1) {
      if (messagesToRender[i]?.role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        animation: "viewFadeIn 0.5s var(--easing-soft) both",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          background: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(12px) saturate(180%)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Logo size={32} showTag />
        <Glass
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 100,
          }}
        >
          <StatusDot kind="online" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-subtle)" }}>
            BrandBot · ativa
          </span>
        </Glass>
      </header>

      {/* Body — split: chat (left) + draft preview (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)",
          gap: 24,
          maxWidth: 1100,
          margin: "0 auto",
          padding: "32px 24px 0",
        }}
      >
        {/* Chat column */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 130px)" }}>
          {data.ready_to_finish && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                marginBottom: 16,
                borderRadius: 14,
                background: "linear-gradient(135deg, var(--green-light), rgba(34,197,94,0.18))",
                border: "1px solid var(--green-border)",
                animation: "fadeIn 0.4s var(--easing-soft) both",
              }}
            >
              <CheckIcon size={20} color="var(--green-700)" strokeWidth={3} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--green-700)" }}>
                  Pronto, capturei sua marca
                </div>
                <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
                  {autoAdvanceCancelled
                    ? "Quando quiser, click pra ir pra revisão."
                    : "Levando você pra revisão em 2s…"}
                </div>
              </div>
              {!autoAdvanceCancelled && (
                <button
                  onClick={() => setAutoAdvanceCancelled(true)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 100,
                    background: "transparent",
                    color: "var(--text-subtle)",
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => navigate("/onboarding/reveal")}
                style={{
                  padding: "8px 18px",
                  borderRadius: 100,
                  background: "linear-gradient(135deg, var(--green), var(--green-700))",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                  boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
                }}
              >
                Ver agora
                <ChevronRightIcon size={14} />
              </button>
            </div>
          )}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              paddingBottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {messagesToRender.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                isLatestAssistant={i === lastAssistantIdx}
              />
            ))}
            {sendMessage.isPending && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <AgentAvatar slug="brand-bot" size={36} />
                <Glass style={{ padding: "12px 16px", maxWidth: "80%" }}>
                  <TypingDots />
                </Glass>
              </div>
            )}
          </div>

          {/* Composer */}
          <div
            style={{
              position: "sticky",
              bottom: 0,
              background: "linear-gradient(to bottom, transparent, var(--bg) 30%)",
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            {uploadError && (
              <div
                style={{
                  marginBottom: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "var(--error)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {uploadError}
              </div>
            )}
            <Glass style={{ padding: 8, borderRadius: 24 }}>
              <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleFilePick}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLogo.isPending || sendMessage.isPending}
                  title="Anexar logo (PNG, JPG, SVG, WEBP)"
                  aria-label="Anexar logo"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: uploadLogo.isPending ? "rgba(34,197,94,0.15)" : "transparent",
                    color: "var(--text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: uploadLogo.isPending || sendMessage.isPending ? "default" : "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  {uploadLogo.isPending ? (
                    <Spinner size={16} thickness={2} />
                  ) : (
                    <PaperclipIcon size={18} />
                  )}
                </button>
                <textarea
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmit(e as unknown as FormEvent);
                    }
                  }}
                  placeholder="Manda sua mensagem ou anexa logo no clipe…"
                  rows={1}
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
                    maxHeight: 160,
                    minHeight: 24,
                  }}
                  disabled={sendMessage.isPending}
                />
                <button
                  type="submit"
                  disabled={!draftInput.trim() || sendMessage.isPending}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background:
                      draftInput.trim() && !sendMessage.isPending
                        ? "linear-gradient(135deg, var(--green), var(--green-700))"
                        : "rgba(0,0,0,0.08)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  aria-label="Enviar"
                >
                  <SendIcon size={16} strokeWidth={2.5} />
                </button>
              </form>
            </Glass>
          </div>
        </div>

        {/* Draft preview column */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: "sticky",
            top: 96,
            alignSelf: "start",
            maxHeight: "calc(100dvh - 120px)",
          }}
        >
          <DraftPreview draft={data.draft} />
          {data.ready_to_finish && (
            <CTA onClick={() => navigate("/onboarding/reveal")}>
              Ver minha marca <ChevronRightIcon size={16} />
            </CTA>
          )}
        </aside>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isLatestAssistant,
}: {
  message: OnboardingMessage;
  isLatestAssistant: boolean;
}) {
  const isUser = message.role === "user";

  // Special-case: a "[anexei meu logo: URL]" message renders the image inline
  // instead of the literal text. The pseudo-message exists in the chat so the
  // next BrandBot turn knows the upload happened.
  const logoMatch = message.content.match(/^\[anexei meu logo: (https?:\/\/\S+?)\]\s*$/);
  const logoUrl =
    logoMatch?.[1] ??
    (message.metadata && typeof message.metadata === "object"
      ? ((message.metadata as { logo_url?: string }).logo_url ?? null)
      : null);

  // Animate every new bubble in. We rely on key={message.id} forcing a fresh
  // mount, so the keyframe runs once per message regardless of whether other
  // messages re-render.
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
        animation: "slideUp 0.3s var(--easing-soft) both",
      }}
    >
      {!isUser && <AgentAvatar slug="brand-bot" size={36} />}
      <div
        style={{
          maxWidth: "80%",
          padding: logoUrl ? 6 : "12px 16px",
          borderRadius: 18,
          background: isUser
            ? "linear-gradient(135deg, var(--green), var(--green-600))"
            : "var(--surface-glass)",
          color: isUser ? "#fff" : "var(--text-strong)",
          border: isUser ? "none" : "1px solid var(--surface-glass-border)",
          backdropFilter: isUser ? "none" : "blur(16px) saturate(180%)",
          boxShadow: isUser
            ? "0 4px 16px rgba(34,197,94,0.2)"
            : "var(--surface-glass-shadow), var(--shadow-inset-top)",
          fontSize: 15,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo enviado"
            style={{
              display: "block",
              maxWidth: 220,
              maxHeight: 220,
              borderRadius: 12,
              background: "rgba(255,255,255,0.25)",
            }}
          />
        ) : !isUser && isLatestAssistant ? (
          <TypeWriter text={message.content} speed={14} />
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}
