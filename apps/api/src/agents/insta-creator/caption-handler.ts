/**
 * InstaCreator Etapa 3 — caption + first_comment + hashtags.
 *
 * Triggered after design_approved. Reads slides_config + brand_snapshot +
 * research_data and produces:
 *   • caption (200-400 words): hook + content + CTA
 *   • first_comment (1-2 sentences): pinned comment with link or CTA
 *   • hashtags (15-30 mix of big/medium/small)
 *
 * Output is structured JSON delimited by ---CAPTION--- markers, parsed
 * server-side.
 */

import { z } from "zod";
import {
  type CreatorPostRow,
  type SlideConfig,
} from "../../db/repositories/creator-posts.js";
import { getDefaultProvider } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import { recall, markUsed } from "../../core/memory-manager.js";
import { buildAgentPrompt } from "../../core/prompt-builder.js";
import { SOUL } from "./soul.js";

const captionOutputSchema = z.object({
  caption: z.string().min(20).max(4000),
  first_comment: z.string().max(2000).optional(),
  hashtags: z.array(z.string()).max(50),
});

export type CaptionOutput = z.infer<typeof captionOutputSchema>;

const CAPTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    first_comment: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
  required: ["caption", "hashtags"],
} as const;

function describeSlides(slides: SlideConfig[]): string {
  return slides
    .map((s) => {
      const tag = s.is_cover ? " [CAPA]" : s.is_cta ? " [CTA]" : "";
      const sub = s.subtitle ? ` — ${s.subtitle}` : "";
      return `Slide ${s.index + 1}${tag}: ${s.title}${sub}`;
    })
    .join("\n");
}

function buildCaptionInstructions(post: CreatorPostRow): string {
  return `# Etapa 3 — Caption + first_comment + hashtags

Os slides já foram aprovados. Sua tarefa agora é escrever:
1. **caption**: gancho que repete a tensão do slide 1, conteúdo expandindo a história, CTA claro. 200-400 palavras. Quebras de linha são bem-vindas.
2. **first_comment** (1-2 frases): será postado como primeiro comentário fixo. Use pra reforçar CTA ou colocar link.
3. **hashtags** (15-30): mix de big (>1M), medium (100k-1M) e small (10k-100k) hashtags relevantes ao nicho do cliente.

Evite:
- Emojis em excesso (1-3 no máximo)
- "Vem comigo nessa jornada" e similares
- Termos do brand-context.forbidden_terms
- Hashtags genéricas (#instagood, #love, #photooftheday)

# Slides já aprovados:
${describeSlides(post.slides_config)}

# Saída em JSON ESTRITO (será parseado):
{
  "caption": "...",
  "first_comment": "...",
  "hashtags": ["#tag1", "#tag2", ...]
}`;
}

export interface RunCaptionStageArgs {
  post: CreatorPostRow;
}

export interface RunCaptionStageResult {
  caption: CaptionOutput;
  tokens: { input?: number; output?: number };
  model: string;
  memoriesUsed: number;
}

export async function runCaptionStage(
  args: RunCaptionStageArgs,
): Promise<RunCaptionStageResult> {
  const { post } = args;
  const queryText = post.slides_config.map((s) => s.title).join(" ");
  const { memories } = await recall({
    companyId: post.company_id,
    agentSlug: "insta-creator",
    query: queryText,
  });

  const systemPrompt = await buildAgentPrompt({
    companyId: post.company_id,
    soul: SOUL,
    systemPrompt: buildCaptionInstructions(post),
    memories,
  });

  const r = await getDefaultProvider().chat(
    [{ role: "user", content: "Gere agora a caption + first_comment + hashtags pros slides aprovados acima." }],
    {
      system: systemPrompt,
      tier: "pro",
      temperature: 0.75,
      maxOutputTokens: 2048,
      responseSchema: CAPTION_RESPONSE_SCHEMA,
    },
  );

  if (memories.length > 0) {
    void markUsed(memories.map((m) => m.id)).catch(() => undefined);
  }

  let parsed: CaptionOutput;
  try {
    parsed = captionOutputSchema.parse(JSON.parse(r.content));
  } catch (err) {
    logger.error(
      { err: (err as Error).message, sample: r.content.slice(0, 300) },
      "caption-handler: failed to parse response",
    );
    throw new Error("Caption parse failed: " + (err as Error).message);
  }

  return {
    caption: parsed,
    tokens: r.tokens,
    model: r.model,
    memoriesUsed: memories.length,
  };
}
