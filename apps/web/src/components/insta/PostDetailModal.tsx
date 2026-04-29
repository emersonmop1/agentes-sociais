import { useEffect, useState } from "react";
import {
  useApprovePost,
  useDeletePost,
  useGenerateCaption,
  useGenerateSlides,
  useManualPublish,
  usePost,
  useRegenerateImage,
  useRegenerateSlide,
  useRejectPost,
  useRenderStatus,
  useSubmitFinal,
  useUpdateCaption,
  type PostDetail,
  type SlideConfig,
} from "../../hooks/useInstaPosts";
import {
  useAutoPublish,
  useConnectInstagram,
  useIntegrationStatus,
  usePublishStatus,
} from "../../hooks/useIntegrations";
import { CTA } from "../ui/CTA";
import { Glass } from "../ui/Glass";
import { Spinner } from "../ui/Spinner";
import { Timeline } from "../ui/Timeline";
import { useInstaPostTimeline } from "../../hooks/useTimeline";

export interface PostDetailModalProps {
  postId: string | null;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  copy_review: "Revisar copy",
  copy_approved: "Copy aprovada",
  design_review: "Revisar design",
  design_approved: "Design aprovado",
  caption_review: "Revisar caption",
  caption_approved: "Caption aprovada",
  final_review: "Revisão final",
  ready: "Pronto",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  publish_failed: "Falhou",
  rejected: "Rejeitado",
};

export function PostDetailModal({ postId, onClose }: PostDetailModalProps) {
  const { data, isLoading } = usePost(postId ?? undefined);
  const approve = useApprovePost();
  const reject = useRejectPost();
  const generateSlides = useGenerateSlides();
  const generateCaption = useGenerateCaption();
  const updateCaption = useUpdateCaption();
  const submitFinal = useSubmitFinal();
  const manualPublish = useManualPublish();
  const del = useDeletePost();

  const post = data?.post ?? null;
  const isRendering =
    post?.status === "copy_approved" &&
    Boolean(generateSlides.isSuccess || generateSlides.isPending);
  useRenderStatus(postId ?? undefined, isRendering); // side-effect polling, results land in usePost

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (postId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [postId, onClose]);

  if (!postId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Glass
        style={{
          width: "100%",
          maxWidth: 1100,
          maxHeight: "90vh",
          background: "rgba(255,255,255,0.95)",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {isLoading || !post ? (
          <div style={{ padding: 64, display: "flex", justifyContent: "center" }}>
            <Spinner />
          </div>
        ) : (
          <PostDetailBody
            post={post}
            onClose={onClose}
            onApprove={() => approve.mutate(post.id)}
            approveDisabled={approve.isPending}
            onReject={() => setRejectOpen(true)}
            onGenerate={() => generateSlides.mutate(post.id)}
            generateDisabled={generateSlides.isPending}
            isRendering={isRendering}
            onGenerateCaption={() => generateCaption.mutate(post.id)}
            generatingCaption={generateCaption.isPending}
            onUpdateCaption={(caption, first_comment, hashtags) =>
              updateCaption.mutateAsync({
                postId: post.id,
                caption,
                first_comment,
                hashtags,
              })
            }
            onSubmitFinal={() => submitFinal.mutate(post.id)}
            submitFinalPending={submitFinal.isPending}
            onManualPublish={(url) =>
              manualPublish.mutateAsync({
                postId: post.id,
                external_post_url: url || undefined,
              })
            }
            manualPublishPending={manualPublish.isPending}
            onDelete={() => {
              if (window.confirm("Excluir este post?")) {
                del.mutate(post.id);
                onClose();
              }
            }}
          />
        )}

        {rejectOpen && post && (
          <RejectPanel
            onCancel={() => {
              setRejectOpen(false);
              setRejectFeedback("");
            }}
            onSubmit={async () => {
              await reject.mutateAsync({ postId: post.id, feedback: rejectFeedback });
              setRejectOpen(false);
              setRejectFeedback("");
            }}
            feedback={rejectFeedback}
            setFeedback={setRejectFeedback}
            disabled={reject.isPending || !rejectFeedback.trim()}
          />
        )}
      </Glass>
    </div>
  );
}

interface PostDetailBodyProps {
  post: PostDetail;
  onClose: () => void;
  onApprove: () => void;
  approveDisabled: boolean;
  onReject: () => void;
  onGenerate: () => void;
  generateDisabled: boolean;
  isRendering: boolean;
  onGenerateCaption: () => void;
  generatingCaption: boolean;
  onUpdateCaption: (
    caption?: string,
    first_comment?: string | null,
    hashtags?: string[],
  ) => Promise<unknown>;
  onSubmitFinal: () => void;
  submitFinalPending: boolean;
  onManualPublish: (url: string) => Promise<unknown>;
  manualPublishPending: boolean;
  onDelete: () => void;
}

function PostDetailBody({
  post,
  onClose,
  onApprove,
  approveDisabled,
  onReject,
  onGenerate,
  generateDisabled,
  isRendering,
  onGenerateCaption,
  generatingCaption,
  onUpdateCaption,
  onSubmitFinal,
  submitFinalPending,
  onManualPublish,
  manualPublishPending,
  onDelete,
}: PostDetailBodyProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const slide = post.slides_config[activeIdx];

  return (
    <>
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            {STATUS_LABEL[post.status] ?? post.status}
          </div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-strong)",
              lineHeight: 1.3,
              maxWidth: 700,
            }}
          >
            {post.title}
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onDelete}
            title="Excluir"
            style={{
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 13,
              padding: "6px 10px",
              borderRadius: 8,
            }}
          >
            Excluir
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              color: "var(--text-subtle)",
              fontSize: 24,
              padding: "0 8px",
              lineHeight: 1,
            }}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      </header>

      {/* Body — slide carousel + meta */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 1fr)",
          gap: 24,
          padding: 24,
        }}
      >
        {/* Left: slide preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SlidePreview
            slide={slide}
            visualStyle={post.visual_style}
            isRendering={isRendering}
          />
          {slide && showRegenerateImage(post.status, post.visual_style) && (
            <RegenerateImagePanel
              postId={post.id}
              slideIndex={slide.index}
              currentSearchQuery={slide.image?.search_query}
              visualStyle={post.visual_style}
            />
          )}
          <SlideThumbStrip
            slides={post.slides_config}
            activeIdx={activeIdx}
            onPick={setActiveIdx}
          />
        </div>

        {/* Right: meta panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {slide && <SlideTextCard slide={slide} />}
          {showCaptionCard(post.status) && (
            <CaptionCard
              post={post}
              onGenerate={onGenerateCaption}
              generating={generatingCaption}
              onUpdate={onUpdateCaption}
            />
          )}
          {showManualPublishCard(post.status) && post.caption && (
            <PublishCard
              post={post}
              onManualPublish={onManualPublish}
              manualPublishing={manualPublishPending}
            />
          )}
          {post.status === "published" && (
            <PublishedCard post={post} />
          )}
          <PostInfoCard post={post} />
          {post.rejection_feedback && (
            <Glass
              style={{
                padding: 14,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--error)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Feedback de rejeição
              </div>
              <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.5 }}>
                {post.rejection_feedback}
              </div>
            </Glass>
          )}

          <PostTimelineSection postId={post.id} />
        </div>
      </div>

      {/* Footer — status-aware actions */}
      <footer
        style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          alignItems: "center",
          flexShrink: 0,
          background: "rgba(0,0,0,0.02)",
        }}
      >
        <ActionBar
          post={post}
          onApprove={onApprove}
          onReject={onReject}
          onGenerate={onGenerate}
          approveDisabled={approveDisabled}
          generateDisabled={generateDisabled}
          isRendering={isRendering}
          onGenerateCaption={onGenerateCaption}
          generatingCaption={generatingCaption}
          onSubmitFinal={onSubmitFinal}
          submitFinalPending={submitFinalPending}
        />
      </footer>
    </>
  );
}

function SlidePreview({
  slide,
  visualStyle,
  isRendering,
}: {
  slide?: SlideConfig;
  visualStyle: string;
  isRendering: boolean;
}) {
  const url = slide?.rendered_url ?? slide?.image?.url;
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "4 / 5",
        background: "rgba(0,0,0,0.04)",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--border)",
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: slide?.rendered_url ? "cover" : "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            color: "var(--text-muted)",
            padding: 32,
            textAlign: "center",
          }}
        >
          {isRendering ? (
            <>
              <Spinner />
              <div style={{ fontSize: 13 }}>Renderizando…</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 32 }}>🖼️</div>
              <div style={{ fontSize: 13 }}>
                Slide ainda não renderizado
              </div>
            </>
          )}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "4px 10px",
          background: "rgba(15,23,42,0.65)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 100,
          backdropFilter: "blur(4px)",
        }}
      >
        {visualStyleLabel(visualStyle)}
      </div>
    </div>
  );
}

function SlideThumbStrip({
  slides,
  activeIdx,
  onPick,
}: {
  slides: SlideConfig[];
  activeIdx: number;
  onPick: (idx: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {slides.map((s) => {
        const url = s.rendered_url ?? s.image?.url;
        const isActive = s.index === activeIdx;
        return (
          <button
            key={s.index}
            onClick={() => onPick(s.index)}
            style={{
              flex: "0 0 60px",
              width: 60,
              height: 75,
              borderRadius: 6,
              padding: 0,
              background: url ? "transparent" : "rgba(0,0,0,0.04)",
              border: isActive ? "2px solid var(--green)" : "1px solid var(--border)",
              overflow: "hidden",
              position: "relative",
              cursor: "pointer",
            }}
            title={s.title}
          >
            {url && (
              <img
                src={url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
            <span
              style={{
                position: "absolute",
                top: 2,
                left: 4,
                fontSize: 10,
                fontWeight: 700,
                color: url ? "#fff" : "var(--text-muted)",
                textShadow: url ? "0 1px 2px rgba(0,0,0,0.5)" : undefined,
              }}
            >
              {s.index + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SlideTextCard({ slide }: { slide: SlideConfig }) {
  return (
    <Glass style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Slide {slide.index + 1}
        {slide.is_cover && " · capa"}
        {slide.is_cta && " · CTA"}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)", marginBottom: slide.subtitle ? 8 : 0, lineHeight: 1.35 }}>
        {slide.title}
      </div>
      {slide.subtitle && (
        <div style={{ fontSize: 14, color: "var(--text-subtle)", lineHeight: 1.45 }}>
          {slide.subtitle}
        </div>
      )}
      {slide.body && (
        <div style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5, marginTop: 8 }}>
          {slide.body}
        </div>
      )}
      {slide.image?.search_query && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, fontStyle: "italic" }}>
          🔎 {slide.image.search_query}
        </div>
      )}
    </Glass>
  );
}

function PostInfoCard({ post }: { post: PostDetail }) {
  return (
    <Glass style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Detalhes
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
        <dt style={{ color: "var(--text-muted)" }}>Slides:</dt>
        <dd style={{ color: "var(--text-strong)" }}>{post.slides_count}</dd>
        <dt style={{ color: "var(--text-muted)" }}>Estilo:</dt>
        <dd style={{ color: "var(--text-strong)" }}>{visualStyleLabel(post.visual_style)}</dd>
        <dt style={{ color: "var(--text-muted)" }}>Revisões:</dt>
        <dd style={{ color: "var(--text-strong)" }}>{post.revision_count}</dd>
        <dt style={{ color: "var(--text-muted)" }}>Criado:</dt>
        <dd style={{ color: "var(--text-strong)" }}>
          {new Date(post.created_at).toLocaleString("pt-BR")}
        </dd>
      </dl>
    </Glass>
  );
}

interface ActionBarProps {
  post: PostDetail;
  onApprove: () => void;
  onReject: () => void;
  onGenerate: () => void;
  approveDisabled: boolean;
  generateDisabled: boolean;
  isRendering: boolean;
  onGenerateCaption: () => void;
  generatingCaption: boolean;
  onSubmitFinal: () => void;
  submitFinalPending: boolean;
}

function ActionBar({
  post,
  onApprove,
  onReject,
  onGenerate,
  approveDisabled,
  generateDisabled,
  isRendering,
  onGenerateCaption,
  generatingCaption,
  onSubmitFinal,
  submitFinalPending,
}: ActionBarProps) {
  const rejectBtn = (
    <button
      onClick={onReject}
      style={{
        background: "transparent",
        color: "var(--error)",
        border: "1px solid var(--error)",
        padding: "10px 18px",
        borderRadius: 100,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Rejeitar
    </button>
  );

  switch (post.status) {
    case "copy_review":
      return (
        <>
          {rejectBtn}
          <CTA onClick={onApprove} disabled={approveDisabled}>
            Aprovar copy →
          </CTA>
        </>
      );
    case "copy_approved":
      return (
        <CTA onClick={onGenerate} disabled={generateDisabled || isRendering}>
          {isRendering ? "Renderizando…" : "Gerar slides →"}
        </CTA>
      );
    case "design_review":
      return (
        <>
          {rejectBtn}
          <CTA onClick={onApprove} disabled={approveDisabled}>
            Aprovar design →
          </CTA>
        </>
      );
    case "design_approved":
      return (
        <CTA onClick={onGenerateCaption} disabled={generatingCaption}>
          {generatingCaption ? "Gerando caption…" : "Gerar caption →"}
        </CTA>
      );
    case "caption_review":
      return (
        <>
          {rejectBtn}
          <CTA onClick={onApprove} disabled={approveDisabled}>
            Aprovar caption →
          </CTA>
        </>
      );
    case "caption_approved":
      return (
        <CTA onClick={onSubmitFinal} disabled={submitFinalPending}>
          {submitFinalPending ? "Enviando…" : "Enviar pra revisão final →"}
        </CTA>
      );
    case "final_review":
      return (
        <>
          {rejectBtn}
          <CTA onClick={onApprove} disabled={approveDisabled}>
            Aprovar e marcar como pronto →
          </CTA>
        </>
      );
    case "ready":
    case "publish_failed":
      return (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Use o card "Publicar" no painel ao lado
        </span>
      );
    case "scheduled":
      return (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Agendado para {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString("pt-BR") : "—"}
        </span>
      );
    default:
      return (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Status: {STATUS_LABEL[post.status] ?? post.status}
        </span>
      );
  }
}

function RejectPanel({
  onCancel,
  onSubmit,
  feedback,
  setFeedback,
  disabled,
}: {
  onCancel: () => void;
  onSubmit: () => Promise<void> | void;
  feedback: string;
  setFeedback: (s: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 10,
      }}
    >
      <div style={{ maxWidth: 480, width: "100%" }}>
        <h3 style={{ marginBottom: 8 }}>O que tá ruim?</h3>
        <p style={{ fontSize: 13, color: "var(--text-subtle)", marginBottom: 14 }}>
          A correção volta o post pro draft e o agente vai usar isso pra refazer.
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          placeholder="Ex: hook fraco no slide 1, evita 'jornada', quero mais número específico…"
          autoFocus
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            borderRadius: 10,
            border: "1.5px solid var(--border)",
            background: "rgba(255,255,255,0.7)",
            outline: "none",
            resize: "vertical",
            minHeight: 100,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button
            onClick={onCancel}
            style={{ background: "transparent", color: "var(--text-subtle)", padding: "10px 18px", fontSize: 14, fontWeight: 600 }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={disabled}
            style={{
              background: "var(--error)",
              color: "#fff",
              padding: "10px 22px",
              borderRadius: 100,
              fontSize: 14,
              fontWeight: 600,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Rejeitar
          </button>
        </div>
      </div>
    </div>
  );
}

function visualStyleLabel(slug: string): string {
  switch (slug) {
    case "tweet_thread": return "Tweet Carrossel";
    case "dark":         return "Carrossel Dark";
    case "acid_text":    return "Texto Ácido";
    case "tweet_single": return "Post Único";
    default:             return slug;
  }
}

// ─── Caption card (visible from design_approved onwards) ────────────────

function showCaptionCard(status: string): boolean {
  return [
    "design_approved",
    "caption_review",
    "caption_approved",
    "final_review",
    "ready",
    "scheduled",
    "publishing",
    "publish_failed",
    "published",
  ].includes(status);
}

function CaptionCard({
  post,
  onGenerate,
  generating,
  onUpdate,
}: {
  post: PostDetail;
  onGenerate: () => void;
  generating: boolean;
  onUpdate: (
    caption?: string,
    first_comment?: string | null,
    hashtags?: string[],
  ) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption ?? "");
  const [firstComment, setFirstComment] = useState(post.first_comment ?? "");
  const [hashtags, setHashtags] = useState((post.hashtags ?? []).join(" "));
  const [saving, setSaving] = useState(false);

  // Re-sync local state when post updates externally
  useEffect(() => {
    if (!editing) {
      setCaption(post.caption ?? "");
      setFirstComment(post.first_comment ?? "");
      setHashtags((post.hashtags ?? []).join(" "));
    }
  }, [post.caption, post.first_comment, post.hashtags, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = hashtags
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`));
      await onUpdate(caption, firstComment || null, tags);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const empty = !post.caption;

  return (
    <Glass style={{ padding: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Caption
        </div>
        {!editing && !empty && (
          <button
            onClick={() => setEditing(true)}
            style={{
              background: "transparent",
              color: "var(--green-700)",
              fontSize: 12,
              fontWeight: 600,
              padding: 0,
            }}
          >
            Editar
          </button>
        )}
      </div>

      {empty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5 }}>
            Ainda não foi gerada. Clique abaixo pra gerar caption + first comment + hashtags
            puxando dos slides aprovados e da voz da marca.
          </p>
          <button
            onClick={onGenerate}
            disabled={generating}
            style={{
              background: "var(--green-light)",
              color: "var(--green-700)",
              border: "1px solid var(--green-border)",
              padding: "8px 14px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: generating ? "not-allowed" : "pointer",
              opacity: generating ? 0.6 : 1,
              alignSelf: "flex-start",
            }}
          >
            {generating ? "Gerando…" : "Gerar caption ✨"}
          </button>
        </div>
      ) : editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={6}
            placeholder="Caption"
            style={{ ...textareaStyle, minHeight: 120 }}
          />
          <textarea
            value={firstComment}
            onChange={(e) => setFirstComment(e.target.value)}
            rows={2}
            placeholder="First comment (fixado)"
            style={{ ...textareaStyle, minHeight: 50 }}
          />
          <textarea
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            rows={3}
            placeholder="Hashtags separadas por espaço"
            style={{ ...textareaStyle, minHeight: 60 }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              style={{ background: "transparent", color: "var(--text-subtle)", fontSize: 12, fontWeight: 600, padding: "6px 10px" }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: "var(--green)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 100,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {post.caption}
          </div>
          {post.first_comment && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(0,0,0,0.04)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-subtle)",
                lineHeight: 1.45,
              }}
            >
              <strong>1º comentário:</strong> {post.first_comment}
            </div>
          )}
          {post.hashtags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {post.hashtags.map((h) => (
                <span
                  key={h}
                  style={{
                    fontSize: 11,
                    color: "var(--green-700)",
                    background: "var(--green-light)",
                    padding: "2px 8px",
                    borderRadius: 100,
                  }}
                >
                  {h.startsWith("#") ? h : `#${h}`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Glass>
  );
}

const textareaStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  borderRadius: 8,
  border: "1.5px solid var(--border)",
  background: "rgba(255,255,255,0.7)",
  outline: "none",
  resize: "vertical" as const,
  color: "var(--text-strong)",
  lineHeight: 1.5,
};

// ─── Manual publish card (ready / publish_failed) ────────────────────────

function showManualPublishCard(status: string): boolean {
  return ["ready", "scheduled", "publish_failed"].includes(status);
}

function PublishCard({
  post,
  onManualPublish,
  manualPublishing,
}: {
  post: PostDetail;
  onManualPublish: (url: string) => Promise<unknown>;
  manualPublishing: boolean;
}) {
  const status = useIntegrationStatus();
  const connect = useConnectInstagram();
  const autoPublish = useAutoPublish();
  const isPublishing = post.status === "publishing";
  usePublishStatus(post.id, isPublishing); // side-effect polling

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [manualUrl, setManualUrl] = useState("");

  const ig = status.data?.instagram;
  const igConnected = Boolean(ig?.connected);

  const handleConnect = async () => {
    try {
      const r = await connect.mutateAsync();
      window.location.href = r.authorize_url;
    } catch (err) {
      console.error("connect ig failed", err);
    }
  };

  return (
    <Glass
      style={{
        padding: 14,
        background: "rgba(34,197,94,0.08)",
        border: "1px solid rgba(34,197,94,0.25)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green-700)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Publicar
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, padding: 3, background: "rgba(255,255,255,0.6)", borderRadius: 100 }}>
        <ModeTab active={mode === "auto"} onClick={() => setMode("auto")}>
          Automático
        </ModeTab>
        <ModeTab active={mode === "manual"} onClick={() => setMode("manual")}>
          Manual
        </ModeTab>
      </div>

      {mode === "auto" ? (
        igConnected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
              Vai publicar como <strong>@{ig?.username}</strong> via Graph API.
            </p>
            <button
              onClick={() => autoPublish.mutate({ postId: post.id })}
              disabled={autoPublish.isPending || isPublishing}
              style={{
                background: "linear-gradient(135deg, var(--green), var(--green-700))",
                color: "#fff",
                border: "none",
                padding: "10px 14px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                cursor: autoPublish.isPending || isPublishing ? "not-allowed" : "pointer",
                opacity: autoPublish.isPending || isPublishing ? 0.6 : 1,
              }}
            >
              {isPublishing
                ? "Publicando…"
                : autoPublish.isPending
                  ? "Enviando…"
                  : "Publicar agora →"}
            </button>
            {ig?.fb_page_name && (
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                via Página: {ig.fb_page_name}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
              Conecta sua conta Instagram Business pra publicar direto daqui.
              Precisa estar atrelada a uma página do Facebook.
            </p>
            <button
              onClick={handleConnect}
              disabled={connect.isPending}
              style={{
                background: "linear-gradient(135deg, #1877f2, #0a5fc7)",
                color: "#fff",
                border: "none",
                padding: "10px 14px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                cursor: connect.isPending ? "not-allowed" : "pointer",
                opacity: connect.isPending ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {connect.isPending ? "Abrindo…" : "Conectar Instagram"}
            </button>
            {(connect.error as { data?: { error?: string } } | undefined)?.data?.error === "not_configured" && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                Servidor sem INSTAGRAM_APP_ID. Use o modo Manual ou configure o Facebook App.
              </div>
            )}
            {ig?.invalid_reason && (
              <div style={{ fontSize: 11, color: "var(--error)" }}>
                Conexão expirou: {ig.invalid_reason}. Reconecte pra continuar.
              </div>
            )}
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
            Posta no Instagram do app, depois cola o link aqui.
          </p>
          <input
            type="url"
            placeholder="https://instagram.com/p/…"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
            }}
          />
          <button
            onClick={() => void onManualPublish(manualUrl)}
            disabled={manualPublishing}
            style={{
              background: "transparent",
              color: "var(--green-700)",
              border: "1.5px solid var(--green-border)",
              padding: "8px 14px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: manualPublishing ? "not-allowed" : "pointer",
              opacity: manualPublishing ? 0.6 : 1,
            }}
          >
            {manualPublishing ? "Marcando…" : "Marcar como publicado"}
          </button>
        </div>
      )}

      {post.status === "publish_failed" && post.publish_error && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 10, padding: "6px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
          Erro anterior: {post.publish_error}
        </div>
      )}
    </Glass>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? "var(--green-light)" : "transparent",
        color: active ? "var(--green-700)" : "var(--text-subtle)",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 12px",
        borderRadius: 100,
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PublishedCard({ post }: { post: PostDetail }) {
  return (
    <Glass
      style={{
        padding: 14,
        background: "rgba(34,197,94,0.08)",
        border: "1px solid rgba(34,197,94,0.25)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green-700)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        ✓ Publicado
      </div>
      <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
        {post.published_at && (
          <div>Em {new Date(post.published_at).toLocaleString("pt-BR")}</div>
        )}
        {post.external_post_url && (
          <a
            href={post.external_post_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--green-700)", fontWeight: 600, marginTop: 4, display: "inline-block" }}
          >
            Abrir no Instagram →
          </a>
        )}
      </div>
    </Glass>
  );
}

// ─── Regenerate image panel ──────────────────────────────────────────────

function showRegenerateImage(status: string, visualStyle: string): boolean {
  // Only show when there's something to regenerate AND we haven't published.
  // acid_text doesn't use images, so hide there.
  if (visualStyle === "acid_text") return false;
  return [
    "design_review",
    "design_approved",
    "caption_review",
    "caption_approved",
    "final_review",
    "ready",
    "publish_failed",
  ].includes(status);
}

function RegenerateImagePanel({
  postId,
  slideIndex,
  currentSearchQuery,
  visualStyle,
}: {
  postId: string;
  slideIndex: number;
  currentSearchQuery?: string;
  visualStyle: string;
}) {
  const regen = useRegenerateImage();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  const handleQuickRegen = async () => {
    await regen.mutateAsync({ postId, idx: slideIndex });
  };

  const handleCustomRegen = async () => {
    if (!prompt.trim()) return;
    await regen.mutateAsync({
      postId,
      idx: slideIndex,
      prompt: prompt.trim(),
      forceGenerate: true,
    });
    setOpen(false);
    setPrompt("");
  };

  return (
    <Glass style={{ padding: 12, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: open ? 10 : 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Imagem do slide {slideIndex + 1}
          </div>
          {currentSearchQuery && (
            <div
              style={{
                color: "var(--text-subtle)",
                fontStyle: "italic",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={currentSearchQuery}
            >
              🔎 {currentSearchQuery}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={handleQuickRegen}
            disabled={regen.isPending}
            title={visualStyle === "dark" ? "Gerar nova imagem (Gemini)" : "Buscar outra imagem"}
            style={{
              background: "transparent",
              color: "var(--text-strong)",
              border: "1.5px solid var(--border)",
              padding: "6px 12px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 600,
              cursor: regen.isPending ? "not-allowed" : "pointer",
              opacity: regen.isPending ? 0.6 : 1,
            }}
          >
            {regen.isPending ? "…" : visualStyle === "dark" ? "↻ Regenerar" : "↻ Outra busca"}
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={regen.isPending}
            title="Editar prompt e gerar com IA"
            style={{
              background: open ? "var(--green-light)" : "transparent",
              color: open ? "var(--green-700)" : "var(--text-strong)",
              border: open ? "1.5px solid var(--green-border)" : "1.5px solid var(--border)",
              padding: "6px 12px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 600,
              cursor: regen.isPending ? "not-allowed" : "pointer",
            }}
          >
            ✨ Custom
          </button>
        </div>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Descreva a imagem em INGLÊS. Ex: 'a young developer alone in a dark office, blue monitor glow on face, cinematic, 35mm'"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
              resize: "vertical",
              minHeight: 60,
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              onClick={() => {
                setOpen(false);
                setPrompt("");
              }}
              disabled={regen.isPending}
              style={{ background: "transparent", color: "var(--text-subtle)", padding: "6px 10px", fontWeight: 600 }}
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleCustomRegen()}
              disabled={regen.isPending || !prompt.trim()}
              style={{
                background: "linear-gradient(135deg, var(--green), var(--green-700))",
                color: "#fff",
                padding: "6px 14px",
                borderRadius: 100,
                fontSize: 12,
                fontWeight: 600,
                opacity: regen.isPending || !prompt.trim() ? 0.5 : 1,
                cursor: regen.isPending || !prompt.trim() ? "not-allowed" : "pointer",
              }}
            >
              {regen.isPending ? "Gerando…" : "Gerar imagem ✨"}
            </button>
          </div>
        </div>
      )}

      {regen.isError && (
        <div style={{ color: "var(--error)", marginTop: 8, fontSize: 11 }}>
          {(regen.error as { message?: string }).message ?? "Erro ao regenerar"}
        </div>
      )}
    </Glass>
  );
}


function PostTimelineSection({ postId }: { postId: string }) {
  const { data, isLoading } = useInstaPostTimeline(postId);
  const events = data?.events ?? [];
  return (
    <Glass style={{ padding: 14, marginTop: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Timeline ({events.length})
      </div>
      {isLoading ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Carregando…</div>
      ) : (
        <Timeline events={events} emptyText="Sem atividade ainda — comece o chat acima." />
      )}
    </Glass>
  );
}
