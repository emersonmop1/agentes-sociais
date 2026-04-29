import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "../components/ui/AgentAvatar";
import { CTA } from "../components/ui/CTA";
import { Glass } from "../components/ui/Glass";
import { Logo } from "../components/ui/Logo";
import { QuotaBadge } from "../components/ui/QuotaBadge";
import { Spinner } from "../components/ui/Spinner";
import { Timeline } from "../components/ui/Timeline";
import { StudioPanel } from "../components/youtube/StudioPanel";
import { useYouTubeProjectTimeline } from "../hooks/useTimeline";
import {
  useApproveIdeas,
  useApproveThumbs,
  useApproveYTFinal,
  useCreateProject,
  useDeleteProject,
  useGenerateIdeas,
  usePickThumbnail,
  usePickTitle,
  useRegenerateThumb,
  useRejectYT,
  useThumbStatus,
  useYouTubeProject,
  useYouTubeProjects,
  type YouTubeProject,
  type YouTubeProjectSummary,
  type YouTubeStatus,
} from "../hooks/useYouTube";
import {
  useAutoPublishYT,
  useConnectGoogle,
  useIntegrationStatus,
  useManualPublishYT,
  useUpdateSourceVideo,
  useYTPublishStatus,
} from "../hooks/useIntegrations";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

const YT = { emoji: "🚀", gradient: ["#ef4444", "#b91c1c"] as const };

const STATUS_LABEL: Record<YouTubeStatus, string> = {
  draft: "Rascunho",
  transcribing: "Transcrevendo",
  transcribed: "Transcrito",
  ideation: "Gerando ideias",
  ideation_review: "Revisar ideias",
  generating_thumbs: "Gerando thumbs",
  thumbs_review: "Escolher thumb",
  final_review: "Revisão final",
  ready: "Pronto",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  publish_failed: "Falhou",
  rejected: "Rejeitado",
  failed: "Erro",
};

const STATUS_COLOR: Record<YouTubeStatus, string> = {
  draft: "var(--text-muted)",
  transcribing: "#0ea5e9",
  transcribed: "#0ea5e9",
  ideation: "#f59e0b",
  ideation_review: "#f59e0b",
  generating_thumbs: "#8b5cf6",
  thumbs_review: "#8b5cf6",
  final_review: "#22c55e",
  ready: "#16a34a",
  scheduled: "#16a34a",
  publishing: "#0ea5e9",
  published: "#15803d",
  publish_failed: "var(--error)",
  rejected: "var(--error)",
  failed: "var(--error)",
};

export function YouTubeWorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: list } = useYouTubeProjects();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: detail } = useYouTubeProject(activeId ?? undefined);
  const [ytFlash, setYtFlash] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const status = searchParams.get("google_connect");
    if (!status) return;
    if (status === "ok") {
      const channel = searchParams.get("channel");
      setYtFlash({
        kind: "ok",
        text: channel ? `YouTube conectado: ${channel}` : "YouTube conectado",
      });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } else {
      const reason = searchParams.get("reason") ?? "erro desconhecido";
      setYtFlash({ kind: "error", text: `Falha ao conectar: ${reason}` });
    }
    searchParams.delete("google_connect");
    searchParams.delete("channel");
    searchParams.delete("reason");
    setSearchParams(searchParams, { replace: true });
    const t = setTimeout(() => setYtFlash(null), 6000);
    return () => clearTimeout(t);
  }, [searchParams, setSearchParams, qc]);

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh" }}>
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
        <button onClick={() => navigate("/dashboard")} style={{ background: "transparent", padding: 0 }}>
          <Logo size={28} showTag />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AgentAvatar emoji={YT.emoji} gradient={YT.gradient} size={32} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>YouTubeGrowth</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Ideation + thumbs + descrição (cole transcrição)
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <QuotaBadge kind="youtube" />
          <button
            onClick={() => navigate("/dashboard")}
            style={{ background: "transparent", color: "var(--text-subtle)", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8 }}
          >
            ← Dashboard
          </button>
        </div>
      </header>

      {ytFlash && (
        <div
          style={{
            margin: "12px 24px 0",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background:
              ytFlash.kind === "ok"
                ? "linear-gradient(135deg, var(--green), var(--green-600))"
                : "linear-gradient(135deg, #ef4444, #dc2626)",
          }}
        >
          {ytFlash.text}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr)",
          gap: 16,
          padding: "16px",
          height: "calc(100dvh - 65px)",
        }}
      >
        <aside style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
          <button
            onClick={() => setActiveId(null)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: !activeId
                ? "linear-gradient(135deg, var(--green), var(--green-600))"
                : "transparent",
              color: !activeId ? "#fff" : "var(--text-strong)",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo vídeo
          </button>
          {(list?.projects ?? []).map((p) => (
            <ProjectCard key={p.id} project={p} active={p.id === activeId} onClick={() => setActiveId(p.id)} />
          ))}
        </aside>

        <main style={{ overflowY: "auto", padding: "0 4px" }}>
          {!activeId ? (
            <NewProjectPanel onCreated={(id) => setActiveId(id)} />
          ) : !detail ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
              <Spinner />
            </div>
          ) : (
            <ProjectDetail project={detail.project} />
          )}
        </main>
      </div>
    </div>
  );
}

// ─── List card ───────────────────────────────────────────────────────────

function ProjectCard({
  project,
  active,
  onClick,
}: {
  project: YouTubeProjectSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Glass
      onClick={onClick}
      style={{
        padding: 12,
        cursor: "pointer",
        border: active ? "2px solid var(--green-border)" : "1px solid var(--surface-glass-border)",
        background: active ? "var(--green-light)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: STATUS_COLOR[project.status],
          }}
        >
          {STATUS_LABEL[project.status]}
        </span>
        {project.thumbnail_count > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{project.thumbnail_count} thumbs</span>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-strong)",
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {project.chosen_title ?? project.title_options[0] ?? "Sem título ainda"}
      </div>
    </Glass>
  );
}

// ─── New project ─────────────────────────────────────────────────────────

function NewProjectPanel({ onCreated }: { onCreated: (id: string) => void }) {
  const [transcript, setTranscript] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const create = useCreateProject();

  const handleCreate = async () => {
    if (transcript.trim().length < 50) return;
    const r = await create.mutateAsync({
      transcript: transcript.trim(),
      drive_url: driveUrl.trim() || undefined,
    });
    onCreated(r.project.id);
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>
        Novo vídeo do YouTube
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        Cole a transcrição completa do vídeo (gerada no YouTube Studio, Whisper, Descript, etc.).
        Eu gero 5 títulos + chapters + tags + descrição + 4 thumbnails de IA.
      </p>

      <Glass style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)", display: "block", marginBottom: 4 }}>
            URL do vídeo (opcional)
          </label>
          <input
            type="url"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            placeholder="https://drive.google.com/... ou https://youtube.com/watch?v=..."
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)", display: "block", marginBottom: 4 }}>
            Transcrição (mínimo 50 caracteres)
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            placeholder="Cole aqui a transcrição completa do vídeo…"
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.5,
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
              resize: "vertical",
              minHeight: 220,
              color: "var(--text-strong)",
            }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            {transcript.length} caracteres
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <CTA
            onClick={handleCreate}
            disabled={transcript.trim().length < 50 || create.isPending}
          >
            {create.isPending ? "Criando…" : "Criar projeto →"}
          </CTA>
        </div>
      </Glass>
    </div>
  );
}

// ─── Project detail ──────────────────────────────────────────────────────

function ProjectDetail({ project }: { project: YouTubeProject }) {
  const del = useDeleteProject();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 880, margin: "0 auto" }}>
      <Glass style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              background: STATUS_COLOR[project.status],
              padding: "3px 8px",
              borderRadius: 100,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {STATUS_LABEL[project.status]}
          </span>
          <button
            onClick={() => {
              if (window.confirm("Excluir este projeto?")) del.mutate(project.id);
            }}
            style={{ background: "transparent", color: "var(--text-muted)", fontSize: 12, padding: "4px 10px", borderRadius: 8 }}
          >
            Excluir
          </button>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-strong)" }}>
          {project.chosen_title ?? "Aguardando ideation"}
        </h2>
        {project.drive_url && (
          <a
            href={project.drive_url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              marginTop: 6,
              fontSize: 12,
              color: "var(--text-subtle)",
              textDecoration: "none",
            }}
          >
            🔗 {project.drive_url.slice(0, 60)}…
          </a>
        )}
      </Glass>

      {project.rejection_feedback && (
        <Glass
          style={{
            padding: 12,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--error)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Feedback anterior
          </div>
          <div style={{ fontSize: 13, color: "var(--text-strong)" }}>{project.rejection_feedback}</div>
        </Glass>
      )}

      {/* Stage actions */}
      {project.status === "transcribed" && <TranscribedStage project={project} />}
      {project.status === "ideation_review" && <IdeationReviewStage project={project} />}
      {project.status === "generating_thumbs" && <GeneratingThumbsStage project={project} />}
      {project.status === "thumbs_review" && <ThumbsReviewStage project={project} />}
      {project.status === "final_review" && <FinalReviewStage project={project} />}
      {(project.status === "ready" ||
        project.status === "publishing" ||
        project.status === "publish_failed") && <ReadyStage project={project} />}
      {project.status === "published" && (
        <>
          <PublishedStage project={project} />
          <StudioPanel project={project} />
        </>
      )}
      {project.status === "failed" && (
        <Glass style={{ padding: 14, color: "var(--error)" }}>
          <div style={{ fontSize: 13 }}>{project.error}</div>
        </Glass>
      )}

      {/* Always-visible cards once data exists */}
      {project.title_options.length > 0 && (
        <IdeationSummaryCard project={project} />
      )}
      {project.chapters.length > 0 && <ChaptersCard project={project} />}
      <ProjectTimelineSection projectId={project.id} />
    </div>
  );
}

function ProjectTimelineSection({ projectId }: { projectId: string }) {
  const { data, isLoading } = useYouTubeProjectTimeline(projectId);
  const events = data?.events ?? [];
  return (
    <Glass style={{ padding: 16 }}>
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
        <Timeline events={events} emptyText="Sem atividade ainda neste projeto." />
      )}
    </Glass>
  );
}

// ─── Stage panels ────────────────────────────────────────────────────────

function TranscribedStage({ project }: { project: YouTubeProject }) {
  const gen = useGenerateIdeas();
  return (
    <Glass style={{ padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 13, color: "var(--text-subtle)", marginBottom: 12 }}>
        Transcrição carregada ({(project.transcript ?? "").length} chars). Pronto pra ideação.
      </div>
      <CTA onClick={() => gen.mutate(project.id)} disabled={gen.isPending}>
        {gen.isPending ? "Gerando ideias (até 30s)…" : "Gerar 5 títulos + tudo →"}
      </CTA>
    </Glass>
  );
}

function IdeationReviewStage({ project }: { project: YouTubeProject }) {
  const pickT = usePickTitle();
  const approve = useApproveIdeas();
  const reject = useRejectYT();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const handlePick = async (title: string) => {
    await pickT.mutateAsync({ id: project.id, title });
  };

  const handleApprove = async () => {
    if (!project.chosen_title) {
      alert("Escolha um título primeiro");
      return;
    }
    await approve.mutateAsync(project.id);
  };

  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        Escolha o título
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {project.title_options.map((t, i) => {
          const isTop = project.top_3_titles.includes(t);
          const active = project.chosen_title === t;
          return (
            <button
              key={i}
              onClick={() => void handlePick(t)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: active ? "2px solid var(--green)" : "1px solid var(--border)",
                background: active ? "var(--green-light)" : "rgba(255,255,255,0.6)",
                color: "var(--text-strong)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                gap: 8,
                alignItems: "center",
                lineHeight: 1.4,
              }}
            >
              {isTop && <span style={{ fontSize: 12 }}>★</span>}
              <span>{t}</span>
            </button>
          );
        })}
      </div>

      {!rejectOpen ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={() => setRejectOpen(true)}
            style={{
              background: "transparent",
              color: "var(--error)",
              border: "1px solid var(--error)",
              padding: "8px 16px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Rejeitar tudo
          </button>
          <CTA onClick={handleApprove} disabled={approve.isPending || !project.chosen_title}>
            {approve.isPending ? "Gerando thumbs…" : "Aprovar e gerar thumbs →"}
          </CTA>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="O que regenerar/melhorar?"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setRejectOpen(false);
                setFeedback("");
              }}
              style={{ background: "transparent", color: "var(--text-subtle)", padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                if (!feedback.trim()) return;
                await reject.mutateAsync({ id: project.id, feedback: feedback.trim() });
                setRejectOpen(false);
                setFeedback("");
              }}
              disabled={!feedback.trim() || reject.isPending}
              style={{
                background: "var(--error)",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                opacity: !feedback.trim() ? 0.5 : 1,
              }}
            >
              Rejeitar
            </button>
          </div>
        </div>
      )}
    </Glass>
  );
}

function GeneratingThumbsStage({ project }: { project: YouTubeProject }) {
  useThumbStatus(project.id, true);
  return (
    <Glass style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <Spinner />
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
          Gerando 4 thumbnails via Gemini Image
        </div>
        <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
          ~10-20 segundos. A página atualiza sozinha.
        </div>
      </div>
    </Glass>
  );
}

function ThumbsReviewStage({ project }: { project: YouTubeProject }) {
  const pick = usePickThumbnail();
  const approve = useApproveThumbs();
  const regen = useRegenerateThumb();
  const reject = useRejectYT();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        Escolha a thumbnail
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        {project.thumbnail_urls.map((url, i) => {
          const concept = project.thumbnail_concepts[i];
          const active = project.chosen_thumbnail_idx === i;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
                border: active ? "3px solid var(--green)" : "2px solid transparent",
                borderRadius: 12,
                padding: 4,
                background: active ? "var(--green-light)" : "transparent",
              }}
              onClick={() => pick.mutate({ id: project.id, index: i })}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16/9",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "rgba(0,0,0,0.05)",
                }}
              >
                {url ? (
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 12 }}>
                    Aguardando…
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                <span>
                  [{i}] {concept?.emotion}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    regen.mutate({ id: project.id, idx: i });
                  }}
                  style={{
                    background: "transparent",
                    color: "var(--text-strong)",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 6px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                >
                  ↻
                </button>
              </div>
              {concept?.hook_text && (
                <div style={{ fontSize: 11, color: "var(--text-subtle)", textAlign: "center", fontStyle: "italic" }}>
                  "{concept.hook_text}"
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!rejectOpen ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={() => setRejectOpen(true)}
            style={{
              background: "transparent",
              color: "var(--error)",
              border: "1px solid var(--error)",
              padding: "8px 16px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Rejeitar
          </button>
          <CTA
            onClick={() => approve.mutate(project.id)}
            disabled={approve.isPending || project.chosen_thumbnail_idx === null}
          >
            Aprovar thumb →
          </CTA>
        </div>
      ) : (
        <RejectInline
          feedback={feedback}
          setFeedback={setFeedback}
          onCancel={() => {
            setRejectOpen(false);
            setFeedback("");
          }}
          onSubmit={async () => {
            await reject.mutateAsync({ id: project.id, feedback: feedback.trim() });
            setRejectOpen(false);
            setFeedback("");
          }}
          disabled={reject.isPending || !feedback.trim()}
        />
      )}
    </Glass>
  );
}

function FinalReviewStage({ project }: { project: YouTubeProject }) {
  const approve = useApproveYTFinal();
  return (
    <Glass style={{ padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 13, color: "var(--text-subtle)", marginBottom: 12 }}>
        Tudo aprovado. Última conferida visual?
      </div>
      <CTA onClick={() => approve.mutate(project.id)} disabled={approve.isPending}>
        Marcar como pronto pra subir →
      </CTA>
    </Glass>
  );
}

function ReadyStage({ project }: { project: YouTubeProject }) {
  const chosen =
    project.chosen_thumbnail_idx !== null ? project.thumbnail_urls[project.chosen_thumbnail_idx] : null;
  const status = useIntegrationStatus();
  const yt = status.data?.youtube;
  const ytConnected = Boolean(yt?.connected);
  const isPublishing = project.status === "publishing";
  useYTPublishStatus(project.id, isPublishing);

  const connect = useConnectGoogle();
  const updateSrc = useUpdateSourceVideo();
  const auto = useAutoPublishYT();
  const manual = useManualPublishYT();

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [manualUrl, setManualUrl] = useState("");

  const hasSourceVideo = Boolean(project.youtube_url) || Boolean(videoUrl);
  // We don't currently surface storage_video_url back from the API in the
  // detail shape (project.storage_video_url isn't in YouTubeProject) — the
  // user pastes once and we attach it via PUT before publishing.

  const handleConnect = async () => {
    try {
      const r = await connect.mutateAsync();
      window.location.href = r.authorize_url;
    } catch (err) {
      console.error("connect google failed", err);
    }
  };

  const handleAutoPublish = async () => {
    if (!videoUrl.trim()) {
      alert("Cole a URL pública do vídeo (mp4) primeiro");
      return;
    }
    await updateSrc.mutateAsync({ projectId: project.id, url: videoUrl.trim() });
    await auto.mutateAsync({ projectId: project.id, privacy });
  };

  return (
    <Glass
      style={{
        padding: 16,
        background: "rgba(34,197,94,0.08)",
        border: "1px solid rgba(34,197,94,0.25)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green-700)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        ✓ Pronto pra publicar
      </div>

      {chosen && (
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <img src={chosen} alt="" style={{ width: 180, aspectRatio: "16/9", borderRadius: 8, objectFit: "cover" }} />
          <div style={{ fontSize: 13, color: "var(--text-subtle)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-strong)" }}>Thumb escolhida</strong>
            <br />
            <a href={chosen} target="_blank" rel="noreferrer" style={{ color: "var(--green-700)", fontWeight: 600 }}>
              Baixar PNG →
            </a>
            {project.chosen_title && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "var(--text-strong)" }}>Título:</strong> {project.chosen_title}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, padding: 3, background: "rgba(255,255,255,0.6)", borderRadius: 100, width: "fit-content" }}>
        <ModeTab active={mode === "auto"} onClick={() => setMode("auto")}>
          Auto via Data API
        </ModeTab>
        <ModeTab active={mode === "manual"} onClick={() => setMode("manual")}>
          Manual
        </ModeTab>
      </div>

      {mode === "auto" ? (
        ytConnected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
              Vai publicar no canal <strong>{yt?.channel_title}</strong>.
              Cole a URL pública do vídeo MP4 abaixo (Storage signed URL, link do Drive direto, etc.).
            </p>
            <input
              type="url"
              placeholder="https://.../video.mp4"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isPublishing}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                borderRadius: 8,
                border: "1.5px solid var(--border)",
                background: "rgba(255,255,255,0.7)",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "var(--text-subtle)" }}>Privacidade:</label>
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as "private" | "unlisted" | "public")}
                disabled={isPublishing}
                style={{
                  padding: "6px 10px",
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1.5px solid var(--border)",
                  background: "rgba(255,255,255,0.7)",
                  fontFamily: "inherit",
                }}
              >
                <option value="private">Private (só você)</option>
                <option value="unlisted">Unlisted (com link)</option>
                <option value="public">Public</option>
              </select>
            </div>
            <button
              onClick={() => void handleAutoPublish()}
              disabled={auto.isPending || isPublishing || !videoUrl.trim()}
              style={{
                background: "linear-gradient(135deg, var(--green), var(--green-700))",
                color: "#fff",
                border: "none",
                padding: "10px 14px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                cursor: auto.isPending || isPublishing || !videoUrl.trim() ? "not-allowed" : "pointer",
                opacity: auto.isPending || isPublishing || !videoUrl.trim() ? 0.6 : 1,
              }}
            >
              {isPublishing
                ? "Publicando…"
                : auto.isPending
                  ? "Enviando…"
                  : "Publicar agora →"}
            </button>
            {project.status === "publish_failed" && (
              <div style={{ fontSize: 11, color: "var(--error)", marginTop: 4 }}>
                Erro anterior — pode tentar de novo.
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
              Conecte sua conta Google que tem o canal YouTube pra publicar
              direto via Data API. Permissões: upload + manage.
            </p>
            <button
              onClick={handleConnect}
              disabled={connect.isPending}
              style={{
                background: "linear-gradient(135deg, #ea4335, #b00d0d)",
                color: "#fff",
                border: "none",
                padding: "10px 14px",
                borderRadius: 100,
                fontSize: 13,
                fontWeight: 600,
                cursor: connect.isPending ? "not-allowed" : "pointer",
                opacity: connect.isPending ? 0.6 : 1,
                width: "fit-content",
              }}
            >
              {connect.isPending ? "Abrindo…" : "Conectar canal YouTube"}
            </button>
            {(connect.error as { data?: { error?: string } } | undefined)?.data?.error === "not_configured" && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                Servidor sem GOOGLE_CLIENT_ID. Use o modo Manual ou configure OAuth no Google Cloud.
              </div>
            )}
            {yt?.invalid_reason && (
              <div style={{ fontSize: 11, color: "var(--error)" }}>
                Conexão expirou: {yt.invalid_reason}. Reconecte.
              </div>
            )}
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
            Suba o vídeo no Studio com a thumb + título + descrição abaixo,
            depois cola a URL aqui pra marcar como publicado.
          </p>
          <input
            type="url"
            placeholder="https://youtu.be/… ou https://youtube.com/watch?v=…"
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
            onClick={() =>
              void manual.mutateAsync({ projectId: project.id, url: manualUrl })
            }
            disabled={manual.isPending}
            style={{
              background: "transparent",
              color: "var(--green-700)",
              border: "1.5px solid var(--green-border)",
              padding: "8px 14px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              cursor: manual.isPending ? "not-allowed" : "pointer",
              opacity: manual.isPending ? 0.6 : 1,
              width: "fit-content",
            }}
          >
            {manual.isPending ? "Marcando…" : "Marcar como publicado"}
          </button>
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
        background: active ? "var(--green-light)" : "transparent",
        color: active ? "var(--green-700)" : "var(--text-subtle)",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 14px",
        borderRadius: 100,
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PublishedStage({ project }: { project: YouTubeProject }) {
  return (
    <Glass
      style={{
        padding: 16,
        background: "rgba(34,197,94,0.08)",
        border: "1px solid rgba(34,197,94,0.25)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green-700)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        ✓ Publicado no YouTube
      </div>
      {project.youtube_url && (
        <a
          href={project.youtube_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--green-700)", fontWeight: 600, fontSize: 14 }}
        >
          {project.youtube_url} →
        </a>
      )}
    </Glass>
  );
}

function IdeationSummaryCard({ project }: { project: YouTubeProject }) {
  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Description
      </div>
      <div style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
        {project.description}
      </div>
      {project.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 12 }}>
          {project.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                color: "var(--green-700)",
                background: "var(--green-light)",
                padding: "2px 8px",
                borderRadius: 100,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </Glass>
  );
}

function ChaptersCard({ project }: { project: YouTubeProject }) {
  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Chapters
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {project.chapters.map((c, i) => (
          <li key={i} style={{ fontSize: 13, display: "flex", gap: 10 }}>
            <code style={{ color: "var(--green-700)", fontWeight: 600, minWidth: 50 }}>{c.timestamp}</code>
            <span style={{ color: "var(--text-strong)" }}>{c.title}</span>
          </li>
        ))}
      </ul>
      {project.cited_videos.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 14, marginBottom: 6 }}>
            Vídeos citados
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, color: "var(--text-strong)" }}>
            {project.cited_videos.map((v, i) => (
              <li key={i}>• {v.title}</li>
            ))}
          </ul>
        </>
      )}
      {project.end_screen_videos.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 14, marginBottom: 6 }}>
            End screen
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, color: "var(--text-strong)" }}>
            {project.end_screen_videos.map((v, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                • <strong>{v.title}</strong>
                <div style={{ fontSize: 12, color: "var(--text-subtle)", marginLeft: 12 }}>{v.reason}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Glass>
  );
}

function RejectInline({
  feedback,
  setFeedback,
  onCancel,
  onSubmit,
  disabled,
}: {
  feedback: string;
  setFeedback: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="O que regenerar/melhorar?"
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "inherit",
          borderRadius: 8,
          border: "1.5px solid var(--border)",
          background: "rgba(255,255,255,0.7)",
          outline: "none",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{ background: "transparent", color: "var(--text-subtle)", padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
        >
          Cancelar
        </button>
        <button
          onClick={onSubmit}
          disabled={disabled}
          style={{
            background: "var(--error)",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 100,
            fontSize: 13,
            fontWeight: 600,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          Rejeitar
        </button>
      </div>
    </div>
  );
}
