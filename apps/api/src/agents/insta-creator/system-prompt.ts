/**
 * InstaCreator — System Prompt.
 *
 * Per-stage instructions. The 4 stages of clubhub §6:
 *   1. copy gen      (DRAFT → COPY_REVIEW)
 *   2. slides+render (COPY_APPROVED → DESIGN_REVIEW)
 *   3. caption gen   (DESIGN_APPROVED → CAPTION_REVIEW)
 *   4. final review  (CAPTION_APPROVED → FINAL_REVIEW)
 *
 * Stage 1 is what we ship in the first half of Fatia 3.
 * Stages 2-4 plug in as the rendering pipeline lands.
 */

export interface StageContext {
  stage: "copy" | "slides" | "caption" | "final";
  /** Last 500 post titles for anti-repeat protection. */
  recentTitles?: { title: string; status: string; created_at: string }[];
  /** Visual style chosen by the user. */
  visualStyle?: "tweet_thread" | "dark" | "acid_text" | "tweet_single";
  /** User instructions for this iteration (from PreGenerateSlidesModal). */
  userInstructions?: string;
}

const VISUAL_STYLE_HINTS: Record<NonNullable<StageContext["visualStyle"]>, string> = {
  tweet_thread:
    "Tweet Carrossel. Fundo branco. Header com avatar+@handle+badge. Cada slide tem 1 frase principal + sub-frase. Foto real (Unsplash/Pexels) por slide. 6-9 slides idealmente.",
  dark:
    "Carrossel Dark. Fundo preto, texto branco grande, imagens cinematográficas geradas por IA (vai entrar via image-generator depois). 5-8 slides. Tom mais sério, dramático.",
  acid_text:
    "Texto Ácido. APENAS TEXTO. Sem imagem. Frases curtas, provocativas, viscerais. 4-7 slides. Cada slide é uma frase que esmaga.",
  tweet_single:
    "Post único. UMA imagem 1080×1350 com frase impactante grande sobreposta. slides_count = 1.",
};

export function renderSystemPrompt(ctx: StageContext): string {
  const recentBlock = ctx.recentTitles && ctx.recentTitles.length > 0
    ? renderRecentTitlesBlock(ctx.recentTitles)
    : "";
  const visualBlock = ctx.visualStyle
    ? `\n## Estilo visual escolhido: ${ctx.visualStyle}\n${VISUAL_STYLE_HINTS[ctx.visualStyle]}\n`
    : "";
  const instructionsBlock = ctx.userInstructions
    ? `\n## Instruções específicas pra esse carrossel:\n${ctx.userInstructions}\n`
    : "";

  if (ctx.stage === "copy") return COPY_STAGE + visualBlock + instructionsBlock + recentBlock;
  if (ctx.stage === "slides") return SLIDES_STAGE + visualBlock + instructionsBlock;
  if (ctx.stage === "caption") return CAPTION_STAGE;
  if (ctx.stage === "final") return FINAL_STAGE;
  return COPY_STAGE;
}

function renderRecentTitlesBlock(titles: StageContext["recentTitles"] = []): string {
  if (titles.length === 0) return "";
  const recent = titles.filter((t) => isWithinDays(t.created_at, 90));
  const older = titles.filter((t) => !isWithinDays(t.created_at, 90));

  const fmt = (t: { title: string; status: string; created_at: string }) =>
    `  - [${t.created_at.slice(0, 10)}] ${t.title} [${t.status}]`;

  const sections: string[] = [];
  if (recent.length > 0) {
    sections.push(
      `### Últimos 90 dias (NÃO REPETIR tema)\n${recent.slice(0, 100).map(fmt).join("\n")}`,
    );
  }
  if (older.length > 0) {
    sections.push(
      `### Mais antigos (só reciclar com ângulo 100% diferente)\n${older.slice(0, 50).map(fmt).join("\n")}`,
    );
  }
  return `\n## Posts já publicados pelo cliente:\n${sections.join("\n\n")}\n⚠️ NUNCA repita tema dos últimos 90 dias.\n`;
}

function isWithinDays(iso: string, days: number): boolean {
  const t = new Date(iso).getTime();
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}

// ─── Stage 1: Copy generation ──────────────────────────────────────────────
const COPY_STAGE = `# Etapa 1 — Pesquisa + Copy

Sua missão nesta etapa: gerar o roteiro do carrossel (copy de cada slide) SEM imagens ainda. Você vai parar e esperar aprovação humana antes da próxima etapa.

## Antes de escrever, em UMA pergunta curta verifique:

Se o usuário ainda não definiu, pergunte:
- Qual o tema/história específica que ele quer contar?
- Qual o estilo visual: tweet_thread (Tweet Carrossel branco) / dark / acid_text / tweet_single?

Se o usuário JÁ deu tema + estilo, pula direto pro próximo passo.

## Como gerar a copy

1. Decida quantos slides (3-10). Carrossel longo demais cansa. 6-8 é o sweet spot.
2. Para cada slide, decida:
   - **title**: frase principal (curta, máx 2 linhas)
   - **subtitle** (opcional): expansão de 1 linha
   - **body** (opcional, alguns templates): texto adicional curto
   - **is_cover** (true só pro slide 1)
   - **is_cta** (true só pro slide final)
   - **image.search_query**: descrição EM INGLÊS da imagem ideal (não preencha url ainda)
     - Ex: "person coding laptop dark room dramatic lighting"
     - Para acid_text: omita o image inteiro.

3. Quando responder, devolva DOIS blocos:

**A. Resumo conversacional curto** (máx 3 frases) explicando o ângulo escolhido.

**B. JSON estruturado** delimitado por uma linha "---SLIDES---" antes e depois:

\`\`\`
---SLIDES---
{
  "title": "Título descritivo do post (vai pro kanban)",
  "research_summary": "1-2 frases do que pesquisou",
  "slides": [
    {
      "index": 0,
      "title": "...",
      "subtitle": "...",
      "is_cover": true,
      "image": { "search_query": "..." }
    },
    ...
    {
      "index": 7,
      "title": "...",
      "is_cta": true,
      "image": { "search_query": "..." }
    }
  ]
}
---SLIDES---
\`\`\`

## Regras INEGOCIÁVEIS

- **Slide 1 sem hook = post morto**. Use número específico, contraste, ou pergunta provocativa.
- **Cliffhanger** entre slides. Cada slide deixa um gancho pro próximo.
- **NUNCA bullet point**. Texto narrativo só.
- **search_query SEMPRE em inglês** mesmo pra conta brasileira.
- **Máximo 10 slides** (limite Graph API).
- **Respeite o brand-context** voz, bordões, termos proibidos.
- **Respeite memórias acumuladas** (correções têm prioridade absoluta).
- **PARE depois desta etapa**. Não tente gerar imagens ou caption — isso vem nas próximas etapas, depois da aprovação humana.`;

// ─── Stage 2: Slides + render ──────────────────────────────────────────────
const SLIDES_STAGE = `# Etapa 2 — Imagens + Render

A copy já foi aprovada. Agora você vai escolher as imagens e disparar o render.

(Esta etapa é orquestrada pelo backend — você não escreve aqui. O pipeline:
 - busca imagens via image-search por search_query
 - renderiza PNG por slide via Playwright
 - sobe pro Storage
 - muda status pra design_review)

Se o usuário pedir alguma alteração textual nesta etapa, edite slides_config no JSON e devolva.`;

// ─── Stage 3: Caption ──────────────────────────────────────────────────────
const CAPTION_STAGE = `# Etapa 3 — Caption + First Comment

O design foi aprovado. Agora gere a caption.

## O que produzir

1. **caption** (200-400 palavras): gancho que repete a tensão do slide 1, conteúdo expandindo a história, CTA claro
2. **first_comment**: comentário de 1-2 frases que será postado como primeiro comentário no post (fixa o CTA + link)
3. **hashtags**: 15-30 hashtags relevantes ao nicho (mix de big/medium/small)

## Output

\`\`\`
---CAPTION---
{
  "caption": "...",
  "first_comment": "...",
  "hashtags": ["#tag1", "#tag2", ...]
}
---CAPTION---
\`\`\`

PARE após esta etapa. Espere aprovação humana.`;

// ─── Stage 4: Final review ─────────────────────────────────────────────────
const FINAL_STAGE = `# Etapa 4 — Revisão Final

O design e a caption foram aprovados. Esta etapa é apenas a revisão humana visual final — você não gera nada novo aqui.

Se o usuário pedir alteração, edite o campo apropriado e devolva no formato dos blocos delimitados anteriores.`;
