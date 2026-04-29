/**
 * Studio Panel — appears under PublishedStage in YouTube workspace.
 *
 * Two states:
 *   1. No cookies on file → CTA to import cookies (modal with paste textarea
 *      + paste-helper instructions). After import, refetches status.
 *   2. Cookies present → pinned-comment editor + "Apply on YouTube" button
 *      that enqueues the Studio job and polls /studio-status until done.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  useDisconnectStudio,
  useRunStudioAutomation,
  useStudioStatus,
  useStudioStatusForProject,
  useUpdatePinnedComment,
  useUploadStudioCookies,
  type StudioCookie,
} from "../../hooks/useIntegrations";
import { Glass } from "../ui/Glass";
import type { YouTubeProject } from "../../hooks/useYouTube";

export function StudioPanel({
  project,
}: {
  project: YouTubeProject;
}): ReactElement {
  const status = useStudioStatus();
  const isRunning =
    project.studio_status === "queued" || project.studio_status === "running";
  const studioJobStatus = useStudioStatusForProject(project.id, isRunning);

  // Once a "completed" or "failed" event lands, stop polling but keep the
  // last value so the badge shows the final state.
  const lastJob = studioJobStatus.data?.job;

  const connected = status.data?.connected ?? false;

  return (
    <Glass
      style={{
        padding: 16,
        marginTop: 12,
        background: "rgba(239, 68, 68, 0.04)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#b91c1c",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>YouTube Studio Automation</span>
        {connected && (
          <button
            onClick={() => {
              /* opens cookie modal — handled below */
            }}
            style={{
              background: "transparent",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              padding: 0,
              cursor: "pointer",
            }}
            disabled
          >
            {status.data?.expires_at
              ? `Expira ${new Date(status.data.expires_at).toLocaleDateString("pt-BR")}`
              : "conectado"}
          </button>
        )}
      </div>

      {!connected ? (
        <ConnectCookies />
      ) : (
        <PinCommentSection
          project={project}
          isRunning={isRunning}
          lastError={lastJob?.error ?? project.studio_error}
        />
      )}
    </Glass>
  );
}

function ConnectCookies(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-strong)", lineHeight: 1.55, margin: 0 }}>
        Para fixar comentário sob o vídeo no YouTube, preciso dos cookies da
        sua sessão logada (não há API pública). Use uma extensão tipo{" "}
        <em>EditThisCookie</em> ou copie do devtools.
      </p>
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: 12,
          padding: "8px 18px",
          borderRadius: 100,
          background: "linear-gradient(135deg, #ef4444, #b91c1c)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          border: "none",
          cursor: "pointer",
        }}
      >
        Importar cookies do Studio
      </button>
      {open && <CookieImportModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function CookieImportModal({ onClose }: { onClose: () => void }): ReactElement {
  const [raw, setRaw] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const upload = useUploadStudioCookies();

  const handleSubmit = async () => {
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      setParseError(`JSON inválido: ${(err as Error).message}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setParseError("Esperava um array de cookies");
      return;
    }
    // Light normalisation: EditThisCookie / similar exporters use slightly
    // different casing for sameSite. Coerce to Playwright's expected enum.
    const cookies: StudioCookie[] = parsed.map((c: Record<string, unknown>) => ({
      name: String(c.name ?? ""),
      value: String(c.value ?? ""),
      domain: String(c.domain ?? ""),
      path: typeof c.path === "string" ? c.path : "/",
      expires:
        typeof c.expirationDate === "number"
          ? Math.round(c.expirationDate)
          : typeof c.expires === "number"
            ? c.expires
            : undefined,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: normaliseSameSite(c.sameSite),
    }));
    try {
      await upload.mutateAsync(cookies);
      onClose();
    } catch (err) {
      setParseError(`Falha no upload: ${(err as Error).message}`);
    }
  };

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(15, 23, 42, 0.5)",
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
      <Glass style={{ padding: 28, maxWidth: 720, width: "100%" }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text-h)",
            marginBottom: 8,
          }}
        >
          Importar cookies do YouTube Studio
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-subtle)",
            lineHeight: 1.55,
            marginBottom: 14,
          }}
        >
          Cole o JSON exportado da sua extensão de cookies enquanto logado em{" "}
          <code>youtube.com</code>. Filtramos os cookies necessários e
          armazenamos encriptado (AES-256-GCM).
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='[{"name":"SID","value":"...","domain":".google.com",...}, ...]'
          rows={10}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 12,
            resize: "vertical",
          }}
        />
        {parseError && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              fontSize: 12,
              color: "#b91c1c",
            }}
          >
            {parseError}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: 100,
              background: "transparent",
              border: "1px solid var(--border)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={upload.isPending || raw.trim().length === 0}
            style={{
              padding: "8px 22px",
              borderRadius: 100,
              background:
                upload.isPending || raw.trim().length === 0
                  ? "var(--text-muted)"
                  : "linear-gradient(135deg, #ef4444, #b91c1c)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              cursor:
                upload.isPending || raw.trim().length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {upload.isPending ? "Salvando…" : "Salvar cookies"}
          </button>
        </div>
      </Glass>
    </div>
  );
}

function PinCommentSection({
  project,
  isRunning,
  lastError,
}: {
  project: YouTubeProject;
  isRunning: boolean;
  lastError: string | null | undefined;
}): ReactElement {
  const [text, setText] = useState(project.pinned_comment_text ?? "");
  const update = useUpdatePinnedComment();
  const run = useRunStudioAutomation();
  const disconnect = useDisconnectStudio();

  // Sync local state when project changes (e.g. after polling)
  useEffect(() => {
    setText(project.pinned_comment_text ?? "");
  }, [project.pinned_comment_text]);

  const dirty = useMemo(
    () => text.trim() !== (project.pinned_comment_text ?? "").trim(),
    [text, project.pinned_comment_text],
  );

  const canRun =
    !isRunning &&
    text.trim().length > 0 &&
    project.studio_status !== "running" &&
    !dirty;

  const statusBadge = (() => {
    if (project.studio_status === "completed") return "✓ Comentário fixado";
    if (project.studio_status === "running") return "⏳ Aplicando…";
    if (project.studio_status === "queued") return "⌛ Na fila";
    if (project.studio_status === "failed") return "✗ Falhou";
    return null;
  })();

  return (
    <div>
      <label style={{ display: "block", marginBottom: 10 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Comentário fixado
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Comentário que vai ser publicado e fixado sob o vídeo…"
          rows={3}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 13,
            resize: "vertical",
          }}
        />
      </label>

      {statusBadge && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color:
              project.studio_status === "completed"
                ? "var(--green-700)"
                : project.studio_status === "failed"
                  ? "#b91c1c"
                  : "var(--text-strong)",
            marginBottom: 10,
          }}
        >
          {statusBadge}
          {project.studio_completed_at && (
            <span style={{ color: "var(--text-muted)", fontWeight: 500, marginLeft: 8 }}>
              {new Date(project.studio_completed_at).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
      )}

      {lastError && project.studio_status === "failed" && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            fontSize: 12,
            color: "#b91c1c",
            marginBottom: 10,
          }}
        >
          {lastError}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => update.mutate({ projectId: project.id, text })}
          disabled={!dirty || update.isPending}
          style={{
            padding: "8px 16px",
            borderRadius: 100,
            background: dirty ? "var(--green)" : "var(--text-muted)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            border: "none",
            cursor: dirty && !update.isPending ? "pointer" : "not-allowed",
          }}
        >
          {update.isPending ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={() => run.mutate(project.id)}
          disabled={!canRun || run.isPending}
          style={{
            padding: "8px 18px",
            borderRadius: 100,
            background: canRun
              ? "linear-gradient(135deg, #ef4444, #b91c1c)"
              : "var(--text-muted)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            border: "none",
            cursor: canRun ? "pointer" : "not-allowed",
          }}
        >
          {run.isPending ? "Enviando…" : "Aplicar no YouTube"}
        </button>
        <button
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 100,
            background: "transparent",
            border: "1px solid var(--border)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
          }}
          title="Remover cookies do Studio"
        >
          Desconectar
        </button>
      </div>
    </div>
  );
}

function normaliseSameSite(
  v: unknown,
): "Strict" | "Lax" | "None" | undefined {
  if (typeof v !== "string") return undefined;
  const lc = v.toLowerCase();
  if (lc === "strict") return "Strict";
  if (lc === "lax" || lc === "unspecified" || lc === "no_restriction") return "Lax";
  if (lc === "none") return "None";
  return undefined;
}
