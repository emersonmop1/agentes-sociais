import type { ReactElement } from "react";
import type { OnboardingDraft } from "@agentes/shared";
import { Glass } from "../ui/Glass";
import {
  CheckIcon,
  ImageIcon,
  MessageIcon,
  PenIcon,
  TargetIcon,
} from "../icons";
import type { IconProps } from "../icons";

type AreaIcon = (props: IconProps) => ReactElement;

interface Area {
  key: string;
  label: string;
  icon: AreaIcon;
}

const AREAS: readonly Area[] = [
  { key: "name_niche", label: "Nome + nicho", icon: TargetIcon },
  { key: "voice", label: "Voz da marca", icon: MessageIcon },
  { key: "icp", label: "Cliente ideal", icon: PeopleIcon },
  { key: "visual", label: "Visual", icon: ImageIcon },
  { key: "handles", label: "Redes sociais", icon: AtSignIcon },
  { key: "phrases", label: "Bordões", icon: PenIcon },
];

/** Lightweight inline icons just for this card — keeps the file self-contained
 *  while still avoiding emojis. */
function PeopleIcon(props: IconProps) {
  const { size = 18, color = "currentColor", strokeWidth = 2, style, className } = props;
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
      style={style}
      className={className}
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
  const { size = 18, color = "currentColor", strokeWidth = 2, style, className } = props;
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
      style={style}
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

function isCovered(draft: OnboardingDraft, area: string): boolean {
  switch (area) {
    case "name_niche":
      return Boolean(draft.brand_name && draft.niche);
    case "voice":
      return (
        (draft.voice_tone?.length ?? 0) > 0 || (draft.voice_examples?.length ?? 0) > 0
      );
    case "icp":
      return Boolean(draft.icp_description);
    case "visual":
      return Boolean(draft.logo_url || draft.primary_color || draft.secondary_color);
    case "handles":
      return Boolean(
        draft.instagram_handle || draft.tiktok_handle || draft.youtube_channel,
      );
    case "phrases":
      return (
        (draft.signature_phrases?.length ?? 0) > 0 ||
        (draft.forbidden_terms?.length ?? 0) > 0
      );
    default:
      return false;
  }
}

export function DraftPreview({ draft }: { draft: OnboardingDraft }) {
  return (
    <Glass style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
          marginBottom: 14,
          textTransform: "uppercase",
        }}
      >
        Sua marca, conforme captamos
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {AREAS.map((area, i) => {
          const covered = isCovered(draft, area.key);
          const Icon = area.icon;
          return (
            <div
              key={area.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                borderRadius: 10,
                background: covered ? "var(--green-light)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${covered ? "var(--green-border)" : "transparent"}`,
                transition: "all 0.4s ease",
                animation: `brainItemReveal 0.45s var(--easing-bounce) ${80 * i}ms both`,
              }}
            >
              <Icon
                size={18}
                color={covered ? "var(--green-700)" : "var(--text-muted)"}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 500,
                  color: covered ? "var(--green-700)" : "var(--text-subtle)",
                }}
              >
                {area.label}
              </span>
              {covered ? (
                <CheckIcon size={14} color="var(--green)" strokeWidth={3} />
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.1)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {draft.brand_name && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            Marca
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>
            {draft.brand_name}
          </div>
        </div>
      )}
    </Glass>
  );
}
