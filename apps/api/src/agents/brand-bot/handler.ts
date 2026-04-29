import type { OnboardingDraft } from "@agentes/shared";
import { getDefaultProvider } from "../../lib/llm/index.js";
import type { LLMMessage } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import {
  EXTRACTOR_RESPONSE_SCHEMA,
  renderExtractorPrompt,
  type ExtractorOutput,
} from "./extractor-prompt.js";
import { SOUL } from "./soul.js";
import { renderSystemPrompt } from "./system-prompt.js";

/** Areas BrandBot tries to cover. ≥4 + the core 4 → ready_to_finish. */
const ALL_AREAS = ["nome+nicho", "voz", "icp", "visual", "handles", "bordões"] as const;

/** Inspect draft → return list of areas already covered. */
export function coveredAreas(draft: OnboardingDraft): typeof ALL_AREAS[number][] {
  const out: typeof ALL_AREAS[number][] = [];
  if (draft.brand_name && draft.niche) out.push("nome+nicho");
  if ((draft.voice_tone?.length ?? 0) > 0 || (draft.voice_examples?.length ?? 0) > 0)
    out.push("voz");
  // ICP is covered as long as we have ANY structured audience signal — the
  // free-text description, the demographics object, or both. The extractor
  // sometimes only populates target_audience.age and skips icp_description,
  // which used to leave the user stuck "almost-ready". Be generous here.
  if (
    draft.icp_description ||
    draft.target_audience?.age ||
    draft.target_audience?.pain
  ) {
    out.push("icp");
  }
  if (draft.logo_url || draft.primary_color || draft.secondary_color) out.push("visual");
  if (draft.instagram_handle || draft.tiktok_handle || draft.youtube_channel)
    out.push("handles");
  if ((draft.signature_phrases?.length ?? 0) > 0 || (draft.forbidden_terms?.length ?? 0) > 0)
    out.push("bordões");
  return out;
}

/** Have we collected enough? Core 4 (name+niche+voice+icp) + at least 1 extra. */
export function isReadyToFinish(draft: OnboardingDraft): boolean {
  const covered = new Set(coveredAreas(draft));
  const coreOk =
    covered.has("nome+nicho") && covered.has("voz") && covered.has("icp");
  return coreOk && covered.size >= 4;
}

function summarizeDraft(draft: OnboardingDraft): string {
  const parts: string[] = [];
  if (draft.brand_name) parts.push(`- Marca: ${draft.brand_name}`);
  if (draft.niche) parts.push(`- Nicho: ${draft.niche}`);
  if (draft.voice_tone && draft.voice_tone.length > 0)
    parts.push(`- Tom: ${draft.voice_tone.join(", ")}`);
  if (draft.voice_examples && draft.voice_examples.length > 0)
    parts.push(`- Exemplos de voz: ${draft.voice_examples.length} frase(s)`);
  if (draft.icp_description) parts.push(`- ICP: ${draft.icp_description}`);
  if (draft.target_audience?.age || draft.target_audience?.pain)
    parts.push(
      `- Público: ${[draft.target_audience?.age, draft.target_audience?.pain]
        .filter(Boolean)
        .join(", ")}`,
    );
  if (draft.instagram_handle) parts.push(`- Instagram: ${draft.instagram_handle}`);
  if (draft.tiktok_handle) parts.push(`- TikTok: ${draft.tiktok_handle}`);
  if (draft.youtube_channel) parts.push(`- YouTube: ${draft.youtube_channel}`);
  if (draft.primary_color) parts.push(`- Cor primária: ${draft.primary_color}`);
  if (draft.logo_url) parts.push(`- Logo enviada`);
  if (draft.signature_phrases && draft.signature_phrases.length > 0)
    parts.push(`- Bordões: ${draft.signature_phrases.length}`);
  if (draft.forbidden_terms && draft.forbidden_terms.length > 0)
    parts.push(`- Termos proibidos: ${draft.forbidden_terms.length}`);
  return parts.length > 0 ? parts.join("\n") : "(nada ainda)";
}

function missingAreasText(draft: OnboardingDraft): string {
  const covered = new Set(coveredAreas(draft));
  const missing = ALL_AREAS.filter((a) => !covered.has(a));
  return missing.length === 0 ? "(nenhuma — pode finalizar)" : missing.join(", ");
}

/** Build the full prompt that goes to Gemini. */
export function buildPrompt(draft: OnboardingDraft): string {
  return [
    SOUL,
    "",
    renderSystemPrompt({
      draft_summary: summarizeDraft(draft),
      missing_areas: missingAreasText(draft),
      ready_to_finish: isReadyToFinish(draft),
    }),
  ].join("\n");
}

/**
 * Detect the [ONBOARDING_READY] sentinel emitted by BrandBot when it judges
 * the conversation is done. Returns the cleaned text + flag. The agent
 * decides; we just pick up its signal.
 */
export function detectReadySignal(text: string): { text: string; ready: boolean } {
  const tag = "[ONBOARDING_READY]";
  if (text.includes(tag)) {
    return { text: text.replace(tag, "").trim(), ready: true };
  }
  return { text, ready: false };
}

/**
 * Run the structured extractor on a (user_message, agent_reply) pair.
 * Returns a partial draft delta to merge.
 */
export async function extractDraftDelta(args: {
  userMessage: string;
  agentReply: string;
  currentDraft: OnboardingDraft;
}): Promise<ExtractorOutput> {
  const provider = getDefaultProvider();
  const prompt = renderExtractorPrompt({
    user_message: args.userMessage,
    agent_reply: args.agentReply,
    current_draft_json: JSON.stringify(args.currentDraft, null, 2),
  });

  const messages: LLMMessage[] = [{ role: "user", content: prompt }];

  try {
    const r = await provider.chat(messages, {
      tier: "flash",
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseSchema: EXTRACTOR_RESPONSE_SCHEMA,
      thinkingBudget: 0,
    });
    const parsed = JSON.parse(r.content) as ExtractorOutput;
    return parsed;
  } catch (err) {
    // Extractor failure must NOT block the chat. Log and return empty delta.
    logger.warn(
      { err: (err as Error).message },
      "BrandBot extractor failed — onboarding_draft will not advance for this turn",
    );
    return {};
  }
}

/**
 * Merge an extractor delta into the existing draft.
 *
 * Merge rules:
 *   • Scalars (brand_name, niche, icp_description, primary_color, etc.):
 *     overwrite if the delta has a non-empty value.
 *   • Arrays (voice_tone, voice_examples, signature_phrases, forbidden_terms):
 *     dedupe-append (preserve prior items, add new unique ones).
 *   • target_audience.{age,pain}: nested merge.
 */
export function mergeDraft(
  current: OnboardingDraft,
  delta: ExtractorOutput,
): OnboardingDraft {
  const merged: OnboardingDraft = { ...current };

  // Scalars
  if (delta.brand_name) merged.brand_name = delta.brand_name;
  if (delta.niche) merged.niche = delta.niche;
  if (delta.icp_description) merged.icp_description = delta.icp_description;
  if (delta.primary_color) merged.primary_color = delta.primary_color;
  if (delta.secondary_color) merged.secondary_color = delta.secondary_color;
  if (delta.accent_color) merged.accent_color = delta.accent_color;
  if (delta.instagram_handle) merged.instagram_handle = delta.instagram_handle;
  if (delta.tiktok_handle) merged.tiktok_handle = delta.tiktok_handle;
  if (delta.youtube_channel) merged.youtube_channel = delta.youtube_channel;

  // Nested target_audience
  if (delta.target_audience_age || delta.target_audience_pain) {
    merged.target_audience = {
      ...merged.target_audience,
      ...(delta.target_audience_age && { age: delta.target_audience_age }),
      ...(delta.target_audience_pain && { pain: delta.target_audience_pain }),
    };
  }

  // Arrays — dedupe-append
  const dedupeAppend = (existing: string[] | undefined, additions: string[] | undefined) => {
    if (!additions || additions.length === 0) return existing ?? [];
    const set = new Set([...(existing ?? []), ...additions.map((s) => s.trim()).filter(Boolean)]);
    return Array.from(set);
  };

  merged.voice_tone = dedupeAppend(merged.voice_tone, delta.voice_tone);
  merged.voice_examples = dedupeAppend(merged.voice_examples, delta.voice_examples);
  merged.forbidden_terms = dedupeAppend(merged.forbidden_terms, delta.forbidden_terms);
  merged.signature_phrases = dedupeAppend(merged.signature_phrases, delta.signature_phrases);

  return merged;
}
