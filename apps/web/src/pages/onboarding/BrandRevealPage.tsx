import type { OnboardingDraft } from "@agentes/shared";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EditableCard, inputStyle } from "../../components/onboarding/EditableCard";
import { Chip } from "../../components/ui/Chip";
import { CTA } from "../../components/ui/CTA";
import { Glass } from "../../components/ui/Glass";
import { Logo } from "../../components/ui/Logo";
import { Spinner } from "../../components/ui/Spinner";
import {
  ChevronRightIcon,
  MessageIcon,
  PenIcon,
  TargetIcon,
} from "../../components/icons";
import type { IconProps } from "../../components/icons";
import {
  useCompleteOnboarding,
  useOnboardingState,
  usePatchDraft,
} from "../../hooks/useOnboarding";

function PeopleIcon(props: IconProps) {
  const { size = 18, color = "currentColor", strokeWidth = 2 } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function AtSignIcon(props: IconProps) {
  const { size = 18, color = "currentColor", strokeWidth = 2 } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

export function BrandRevealPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useOnboardingState();
  const patch = usePatchDraft();
  const complete = useCompleteOnboarding();
  const [completeError, setCompleteError] = useState<string | null>(null);

  // If somehow we landed here without enough data, send back to chat
  useEffect(() => {
    if (data && !data.draft.brand_name) navigate("/onboarding/chat", { replace: true });
  }, [data, navigate]);

  // After completing, jump to first-task
  const handleComplete = async () => {
    setCompleteError(null);
    try {
      await complete.mutateAsync();
      navigate("/onboarding/first-task", { replace: true });
    } catch (err) {
      const e = err as { data?: { message?: string }; message?: string };
      setCompleteError(e.data?.message ?? e.message ?? "Erro inesperado");
    }
  };

  if (isLoading || !data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <Spinner />
      </div>
    );
  }

  const { draft } = data;

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        animation: "viewFadeIn 0.5s var(--easing-soft) both",
      }}
    >
      <header style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Logo size={32} showTag />
        <button
          onClick={() => navigate("/onboarding/chat")}
          style={{
            background: "transparent",
            color: "var(--text-subtle)",
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 8,
          }}
        >
          ← Voltar pro chat
        </button>
      </header>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 24px 64px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>
          Sua marca, do jeito que entendi
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-subtle)", marginBottom: 32 }}>
          Confere se ficou bom. Pode ajustar tudo aqui ou voltar pro chat se quiser
          contar mais alguma coisa.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <BrandIdentityCard draft={draft} onPatch={patch.mutateAsync} />
          <VoiceCard draft={draft} onPatch={patch.mutateAsync} />
          <IcpCard draft={draft} onPatch={patch.mutateAsync} />
          <HandlesCard draft={draft} onPatch={patch.mutateAsync} />
          <PhrasesCard draft={draft} onPatch={patch.mutateAsync} />
        </div>

        <Glass style={{ padding: 20, marginTop: 24, textAlign: "center" }}>
          {completeError && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--error)",
                marginBottom: 16,
              }}
            >
              {completeError}
            </div>
          )}
          <p style={{ fontSize: 14, color: "var(--text-subtle)", marginBottom: 16 }}>
            Tudo certo? Vamos abrir os agentes.
          </p>
          <CTA onClick={handleComplete} disabled={complete.isPending}>
            {complete.isPending ? "Concluindo…" : (
              <>Concluir setup <ChevronRightIcon size={16} /></>
            )}
          </CTA>
        </Glass>
      </div>
    </div>
  );
}

// ─── Per-area editable cards ──────────────────────────────────────────────

function BrandIdentityCard({
  draft,
  onPatch,
}: {
  draft: OnboardingDraft;
  onPatch: (patch: Partial<OnboardingDraft>) => Promise<unknown> | unknown;
}) {
  const [name, setName] = useState(draft.brand_name ?? "");
  const [niche, setNiche] = useState(draft.niche ?? "");

  return (
    <EditableCard
      title="Identidade"
      icon={<TargetIcon size={18} />}
      onSave={async () => {
        await onPatch({ brand_name: name, niche });
      }}
      summary={
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-strong)" }}>
            {draft.brand_name ?? "—"}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-subtle)" }}>
            {draft.niche ?? "(nicho não definido)"}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          placeholder="Nome da marca"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Nicho (ex: mentoria pra desenvolvedores)"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          style={inputStyle}
        />
      </div>
    </EditableCard>
  );
}

function VoiceCard({
  draft,
  onPatch,
}: {
  draft: OnboardingDraft;
  onPatch: (patch: Partial<OnboardingDraft>) => Promise<unknown> | unknown;
}) {
  const [tone, setTone] = useState((draft.voice_tone ?? []).join(", "));
  const [examples, setExamples] = useState((draft.voice_examples ?? []).join("\n"));

  return (
    <EditableCard
      title="Voz da marca"
      icon={<MessageIcon size={18} />}
      onSave={async () => {
        await onPatch({
          voice_tone: tone.split(",").map((s) => s.trim()).filter(Boolean),
          voice_examples: examples.split("\n").map((s) => s.trim()).filter(Boolean),
        });
      }}
      summary={
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(draft.voice_tone ?? []).length > 0 ? (
              draft.voice_tone!.map((t) => (
                <Chip key={t} variant="green">
                  {t}
                </Chip>
              ))
            ) : (
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>—</span>
            )}
          </div>
          {(draft.voice_examples ?? []).length > 0 && (
            <div style={{ fontSize: 13, color: "var(--text-subtle)", fontStyle: "italic" }}>
              "{draft.voice_examples![0]}"
              {(draft.voice_examples!.length ?? 0) > 1 && (
                <span style={{ marginLeft: 6, fontStyle: "normal", color: "var(--text-muted)" }}>
                  +{draft.voice_examples!.length - 1} exemplos
                </span>
              )}
            </div>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          placeholder="Tags de tom (separe por vírgula): direto, casual, técnico"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder="Exemplos de frases que a marca diria (uma por linha)"
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          rows={3}
          style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
        />
      </div>
    </EditableCard>
  );
}

function IcpCard({
  draft,
  onPatch,
}: {
  draft: OnboardingDraft;
  onPatch: (patch: Partial<OnboardingDraft>) => Promise<unknown> | unknown;
}) {
  const [icp, setIcp] = useState(draft.icp_description ?? "");
  const [age, setAge] = useState(draft.target_audience?.age ?? "");
  const [pain, setPain] = useState(draft.target_audience?.pain ?? "");

  return (
    <EditableCard
      title="Cliente ideal"
      icon={<PeopleIcon size={18} />}
      onSave={async () => {
        await onPatch({
          icp_description: icp,
          target_audience: { age, pain },
        });
      }}
      summary={
        <div style={{ fontSize: 14, color: "var(--text-strong)", lineHeight: 1.55 }}>
          {draft.icp_description ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
          {(draft.target_audience?.age || draft.target_audience?.pain) && (
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-subtle)" }}>
              {[draft.target_audience?.age, draft.target_audience?.pain].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea
          placeholder="Quem é seu cliente ideal? (1-2 frases)"
          value={icp}
          onChange={(e) => setIcp(e.target.value)}
          rows={2}
          style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
        />
        <input
          type="text"
          placeholder="Idade / fase (ex: 25-40 anos, dev pleno-sênior)"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Principal dor / desafio"
          value={pain}
          onChange={(e) => setPain(e.target.value)}
          style={inputStyle}
        />
      </div>
    </EditableCard>
  );
}

function HandlesCard({
  draft,
  onPatch,
}: {
  draft: OnboardingDraft;
  onPatch: (patch: Partial<OnboardingDraft>) => Promise<unknown> | unknown;
}) {
  const [ig, setIg] = useState(draft.instagram_handle ?? "");
  const [tt, setTt] = useState(draft.tiktok_handle ?? "");
  const [yt, setYt] = useState(draft.youtube_channel ?? "");

  return (
    <EditableCard
      title="Redes sociais"
      icon={<AtSignIcon size={18} />}
      onSave={async () => {
        await onPatch({ instagram_handle: ig, tiktok_handle: tt, youtube_channel: yt });
      }}
      summary={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "IG", value: draft.instagram_handle },
            { label: "TikTok", value: draft.tiktok_handle },
            { label: "YouTube", value: draft.youtube_channel },
          ]
            .filter((x) => x.value)
            .map((x) => (
              <Chip key={x.label}>
                {x.label}: {x.value}
              </Chip>
            ))}
          {!draft.instagram_handle && !draft.tiktok_handle && !draft.youtube_channel && (
            <span style={{ fontSize: 14, color: "var(--text-muted)" }}>—</span>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          placeholder="@ Instagram"
          value={ig}
          onChange={(e) => setIg(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="@ TikTok"
          value={tt}
          onChange={(e) => setTt(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Canal YouTube"
          value={yt}
          onChange={(e) => setYt(e.target.value)}
          style={inputStyle}
        />
      </div>
    </EditableCard>
  );
}

function PhrasesCard({
  draft,
  onPatch,
}: {
  draft: OnboardingDraft;
  onPatch: (patch: Partial<OnboardingDraft>) => Promise<unknown> | unknown;
}) {
  const [signature, setSignature] = useState((draft.signature_phrases ?? []).join("\n"));
  const [forbidden, setForbidden] = useState((draft.forbidden_terms ?? []).join(", "));

  return (
    <EditableCard
      title="Bordões e proibidos"
      icon={<PenIcon size={18} />}
      onSave={async () => {
        await onPatch({
          signature_phrases: signature.split("\n").map((s) => s.trim()).filter(Boolean),
          forbidden_terms: forbidden.split(",").map((s) => s.trim()).filter(Boolean),
        });
      }}
      summary={
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(draft.signature_phrases ?? []).length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {draft.signature_phrases!.map((p) => (
                <Chip key={p}>{p}</Chip>
              ))}
            </div>
          ) : null}
          {(draft.forbidden_terms ?? []).length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Proibidos:</span>
              {draft.forbidden_terms!.map((p) => (
                <Chip key={p} variant="muted">
                  {p}
                </Chip>
              ))}
            </div>
          ) : null}
          {(draft.signature_phrases ?? []).length === 0 &&
            (draft.forbidden_terms ?? []).length === 0 && (
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>—</span>
            )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea
          placeholder="Bordões da marca (uma frase por linha)"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={2}
          style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
        />
        <input
          type="text"
          placeholder="Termos proibidos (separe por vírgula)"
          value={forbidden}
          onChange={(e) => setForbidden(e.target.value)}
          style={inputStyle}
        />
      </div>
    </EditableCard>
  );
}
