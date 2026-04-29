import { getBrandConfig, type BrandConfigRow } from "../db/repositories/brand.js";

/**
 * Build the <brand-context>…</brand-context> block injected into every agent
 * prompt. The agent reads this to personalize replies — voice, ICP, taboo
 * words, signature phrases, handles.
 *
 * Returns "" when no brand_config exists yet (e.g. onboarding-in-progress
 * agents like BrandBot don't get one).
 */
export async function buildBrandContext(companyId: string): Promise<string> {
  const brand = await getBrandConfig(undefined, companyId);
  if (!brand) return "";
  return formatBrandContext(brand);
}

export function formatBrandContext(brand: BrandConfigRow): string {
  const lines: string[] = [`Marca: **${brand.brand_name}**`];
  if (brand.niche) lines.push(`Nicho: ${brand.niche}`);

  // Voice
  if (brand.voice_tone.length > 0) {
    lines.push(`Tom de voz: ${brand.voice_tone.join(", ")}`);
  }
  if (brand.voice_examples.length > 0) {
    lines.push(
      "Exemplos de frases que a marca diz:\n" +
        brand.voice_examples.map((e) => `  • "${e}"`).join("\n"),
    );
  }
  if (brand.signature_phrases.length > 0) {
    lines.push(`Bordões da marca: ${brand.signature_phrases.map((p) => `"${p}"`).join(" · ")}`);
  }
  if (brand.forbidden_terms.length > 0) {
    lines.push(
      `⚠️ NUNCA use: ${brand.forbidden_terms.join(", ")}`,
    );
  }

  // ICP / audience
  if (brand.icp_description) {
    lines.push(`Cliente ideal: ${brand.icp_description}`);
  }
  if (brand.target_audience?.age || brand.target_audience?.pain) {
    const parts: string[] = [];
    if (brand.target_audience.age) parts.push(`idade ${brand.target_audience.age}`);
    if (brand.target_audience.pain) parts.push(`dor: ${brand.target_audience.pain}`);
    lines.push(`Público: ${parts.join(" · ")}`);
  }

  // Handles
  const handles: string[] = [];
  if (brand.instagram_handle) handles.push(`Instagram ${brand.instagram_handle}`);
  if (brand.tiktok_handle) handles.push(`TikTok ${brand.tiktok_handle}`);
  if (brand.youtube_channel) handles.push(`YouTube ${brand.youtube_channel}`);
  if (handles.length > 0) lines.push(`Redes: ${handles.join(" · ")}`);

  // Visual (compact)
  lines.push(`Cor primária: ${brand.primary_color}`);

  return `<brand-context>\n${lines.join("\n")}\n</brand-context>`;
}
