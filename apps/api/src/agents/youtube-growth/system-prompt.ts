/**
 * Stage prompts for the YouTubeGrowth agent. Two backend-callable stages:
 *   • IDEATION — given transcript, generates 5 titles + chapters + tags +
 *     description + cited_videos + end_screen_videos.
 *   • THUMBS — given chosen_title + transcript summary, generates 4 distinct
 *     thumbnail concepts (different angles).
 *
 * Each stage's output is delimited by a marker block parsed by the handler.
 */

export interface IdeationContext {
  transcript: string;
  /** Optional channel context if the user has metadata. */
  channel_summary?: string;
  /** Optional duration in seconds. */
  video_duration_s?: number;
}

export interface ThumbContext {
  chosen_title: string;
  transcript_summary: string;
  use_creator_face: boolean;
  /** Optional brand color hint (HEX) */
  primary_color?: string;
}

export function renderIdeationPrompt(ctx: IdeationContext): string {
  const dur = ctx.video_duration_s
    ? `\n## Duração do vídeo: ${Math.round(ctx.video_duration_s / 60)}min`
    : "";
  const channel = ctx.channel_summary
    ? `\n## Canal\n${ctx.channel_summary}`
    : "";

  return `# Etapa: Ideation

Você recebeu a transcrição de um vídeo gravado. Sua missão: gerar todos os ativos textuais pro upload.
${channel}${dur}

## Inputs
- Transcrição completa abaixo, em PT-BR (pode ter erros típicos de ASR).

## O que produzir

1. **5 títulos candidatos** (\`title_options\`) — DIFERENTES em ângulo:
   - Search-friendly (intercepta busca explícita)
   - Curiosity-gap ("eu fiz X — não esperava Y")
   - Listicle ("3 erros que…")
   - POV / story
   - Promise+number ("Como ganhei R$ X em Y dias")
2. **Top 3** (\`top_3_titles\`) — sua escolha pro A/B test do Studio.
3. **description** (300-800 palavras): hook (primeiras 2 linhas viram preview), 1 parágrafo conectando ao gancho, chapters, links/recursos, CTA pra inscrever no fim.
4. **tags** (10-20 termos): mix de high-volume + niche + brand keywords.
5. **chapters** — array de \`{ timestamp: "MM:SS", title: "..." }\`. Mínimo 3, máximo 12.
6. **cited_videos** — vídeos do canal que o agente CITARIA na descrição como leitura recomendada (se a transcrição mencionar tópicos relacionados). Cada item: \`{ title, url? }\`.
7. **end_screen_videos** — 3 sugestões pro end screen (2 videos relacionados + 1 da própria série). Cada item: \`{ title, reason }\`.

## Regras inegociáveis
- Sem CAPS LOCK. Sem emojis no título.
- Cada chapter title é curto (máx 5-6 palavras).
- Hook na description = primeiras 2 linhas, sem "fala galera bem-vindos…".
- Use insights ESPECÍFICOS da transcrição (números, citações, nomes), não genéricos.

## Output

Resposta conversacional curta (1-2 frases) + JSON delimitado:

\`\`\`
---IDEATION---
{
  "title_options": ["...", "...", "...", "...", "..."],
  "top_3_titles": ["...", "...", "..."],
  "description": "...",
  "tags": ["...", "..."],
  "chapters": [{ "timestamp": "00:00", "title": "..." }, ...],
  "cited_videos": [{ "title": "...", "url": "" }, ...],
  "end_screen_videos": [{ "title": "...", "reason": "..." }, ...]
}
---IDEATION---
\`\`\`

## Transcrição completa
"""
${ctx.transcript.slice(0, 50000)}
"""

PARE depois desta etapa. Espera escolha humana.`;
}

export function renderThumbPrompt(ctx: ThumbContext): string {
  return `# Etapa: Estratégia de Thumbnails

O título foi escolhido. Agora gera 4 conceitos de thumbnail DIFERENTES (não 4 versões da mesma).

## Título escolhido
"${ctx.chosen_title}"

## Resumo do conteúdo
${ctx.transcript_summary.slice(0, 2000)}

## Cada conceito

Para cada um dos 4, defina:
- **subject**: quem/o-que aparece na thumb (ex: "creator face em close-up + laptop", "split-screen com gráfico", "objeto físico em zoom dramático")
- **hook_text**: texto OVERLAY (1-3 palavras MÁX, em CAPS opcional). Pode ser vazio se a thumb conta sozinha.
- **emotion**: shock / curiosity / confidence / excitement / contradiction
- **color_palette**: 2-3 cores HEX que dominam a composição
- **composition**: 1 frase descrevendo enquadramento (rule-of-thirds, sujeito esquerda, etc.)
- **image_prompt**: prompt completo EM INGLÊS pro gerador de imagem (Gemini Image), incluindo subject, lighting, style, format hints (16:9, 1280x720)
${
  ctx.use_creator_face
    ? "- **use_creator_face**: SET TRUE em pelo menos 2 dos 4 conceitos. Quando true, o image_prompt deve descrever 'this person' / 'the creator face shown in reference' como sujeito (o sistema vai injetar a foto do criador como conditioning)."
    : "- **use_creator_face**: SEMPRE false (o usuário não subiu fotos)."
}

## 4 ângulos sugeridos

1. Hook visual com creator face (close-up + emoção)
2. Resultado/transformação (before/after, gráfico, número grande)
3. Curiosity-gap (objeto/cena que não revela tudo)
4. Social proof / autoridade (logos, screenshots, pessoas reconhecíveis)

${ctx.primary_color ? `Use ${ctx.primary_color} como cor de marca em pelo menos 1 dos conceitos.\n` : ""}

## Output

\`\`\`
---THUMBS---
{
  "concepts": [
    {
      "index": 0,
      "subject": "...",
      "hook_text": "...",
      "emotion": "shock",
      "color_palette": ["#000000", "#ff0000", "#ffffff"],
      "composition": "...",
      "image_prompt": "Full English prompt for image generator. 16:9 format optimized for YouTube thumbnail at 1280x720 resolution.",
      "use_creator_face": true
    },
    ...
  ]
}
---THUMBS---
\`\`\`

PARE. O backend vai gerar as PNGs em paralelo via Gemini Image.`;
}
