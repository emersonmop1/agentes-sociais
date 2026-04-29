/**
 * Content Supervisor — picks a unique angle for the next post in a Quick Flow
 * batch. Reads the last 500 titles from the company's history and asks Gemini
 * Flash to propose a fresh angle that doesn't repeat any of them.
 *
 * Why a separate service: the InstaCreator's main system prompt already
 * carries a "anti-repeat" block of recent titles, but in a *batch* run those
 * 500 titles all collapse into a single planning step — we need to plan all N
 * topics upfront with cross-batch awareness, then feed each one back into the
 * regular agent. Doing it as one synthetic call before the batch is cheaper
 * than letting the per-post LLM call see the full history each time.
 */

import { z } from "zod";
import { getDefaultProvider, type LLMMessage } from "../lib/llm/index.js";
import { listRecentTitles } from "../db/repositories/creator-posts.js";
import { getBrandConfig } from "../db/repositories/brand.js";

const planSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(3),
        angle: z.string().min(3),
      }),
    )
    .min(1),
});

export interface SupervisorPlan {
  topics: Array<{ title: string; angle: string }>;
}

interface PlanArgs {
  companyId: string;
  count: number;
  /** Optional theme/seed from the user (e.g. "produtividade pra dev"). */
  seed?: string;
}

export async function planUniqueTopics(args: PlanArgs): Promise<SupervisorPlan> {
  if (args.count < 1 || args.count > 10) {
    throw new Error(`count out of range: ${args.count}`);
  }

  const [recent, brand] = await Promise.all([
    listRecentTitles(undefined, args.companyId, 500),
    getBrandConfig(undefined, args.companyId),
  ]);

  const recentTitlesBlock =
    recent.length === 0
      ? "(nenhum post histórico — pode ser bem livre)"
      : recent
          .slice(0, 200) // 200 is plenty for the LLM to spot repeats
          .map((r, i) => `${i + 1}. ${r.title}`)
          .join("\n");

  const brandBlock = brand
    ? [
        `Marca: ${brand.brand_name ?? "(sem nome)"}`,
        brand.niche ? `Nicho: ${brand.niche}` : null,
        brand.icp_description ? `ICP: ${brand.icp_description}` : null,
        Array.isArray(brand.voice_tone) && brand.voice_tone.length
          ? `Voz: ${brand.voice_tone.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "(sem brand context)";

  const seedBlock = args.seed
    ? `\n\nDIREÇÃO DO USUÁRIO (priorize): ${args.seed}`
    : "";

  const systemPrompt = `Você é um Content Supervisor. Sua tarefa: planejar ${args.count} ângulos de post DIFERENTES entre si E diferentes do histórico abaixo. Cada ângulo deve ser específico e produzível como carrossel de Instagram.

CONTEXTO DA MARCA:
${brandBlock}

ÚLTIMOS POSTS (NÃO repita estes ângulos):
${recentTitlesBlock}${seedBlock}

REGRAS:
- ${args.count} tópicos no total
- Nenhum pode ser quase-igual a outro do batch ou do histórico
- "title" curto (≤ 80 chars), "angle" 1-2 frases descrevendo a tese central
- Idioma: português brasileiro
- Formato: SOMENTE JSON, sem markdown fences, sem comentário

ESTRUTURA:
{
  "topics": [
    { "title": "...", "angle": "..." },
    ...
  ]
}`;

  const messages: LLMMessage[] = [
    {
      role: "user",
      content: `Planeje ${args.count} tópicos únicos seguindo as regras.`,
    },
  ];

  const r = await getDefaultProvider().chat(messages, {
    system: systemPrompt,
    tier: "flash",
    temperature: 0.95,
    maxOutputTokens: 2048,
    thinkingBudget: 0,
  });

  // Defensive: strip ```json fences if Gemini decided to add them
  const cleaned = r.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  let parsed;
  try {
    parsed = planSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    throw new Error(
      `supervisor: failed to parse plan JSON: ${(err as Error).message.slice(0, 200)} | raw=${cleaned.slice(0, 200)}`,
    );
  }

  // Trim to requested count if the LLM overshot
  return { topics: parsed.topics.slice(0, args.count) };
}
