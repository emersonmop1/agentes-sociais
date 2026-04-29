/**
 * Stage-aware system prompt for the ReelsCreator agent.
 *
 * The agent emits structured JSON in delimited blocks per stage:
 *   ---HOOKS---     (etapa 1: 5 hook options)
 *   ---SCRIPT---    (etapa 2: beats + chosen_hook confirmed)
 *   ---CAPTION---   (etapa 3: caption + cta + hashtags)
 *   ---BROLL---     (etapa 4: broll list + voice-over + edit notes)
 *
 * The route handler parses whichever block is present and persists.
 */

export type ReelsStage = "hooks" | "script" | "caption" | "broll";

export interface PromptContext {
  stage: ReelsStage;
  /** Free-text instructions from user. */
  userInstructions?: string;
  /** Already-decided fields from prior stages. */
  state?: {
    title?: string;
    theme?: string;
    target_duration?: number;
    chosen_hook?: string | null;
    beats?: unknown;
    caption?: string | null;
    cta?: string | null;
  };
}

export function renderSystemPrompt(ctx: PromptContext): string {
  const stateBlock = ctx.state ? renderStateBlock(ctx.state) : "";
  const instructionsBlock = ctx.userInstructions
    ? `\n## Instruções do usuário pra esta etapa:\n${ctx.userInstructions}\n`
    : "";

  switch (ctx.stage) {
    case "hooks":
      return HOOKS_STAGE + stateBlock + instructionsBlock;
    case "script":
      return SCRIPT_STAGE + stateBlock + instructionsBlock;
    case "caption":
      return CAPTION_STAGE + stateBlock + instructionsBlock;
    case "broll":
      return BROLL_STAGE + stateBlock + instructionsBlock;
  }
}

function renderStateBlock(state: NonNullable<PromptContext["state"]>): string {
  const lines: string[] = ["\n## Estado atual deste Reel"];
  if (state.title) lines.push(`- Título: ${state.title}`);
  if (state.theme) lines.push(`- Tema: ${state.theme}`);
  if (state.target_duration) lines.push(`- Duração-alvo: ${state.target_duration}s`);
  if (state.chosen_hook) lines.push(`- Hook escolhido: "${state.chosen_hook}"`);
  if (state.caption) lines.push(`- Caption: ${state.caption.slice(0, 200)}…`);
  return lines.length > 1 ? lines.join("\n") + "\n" : "";
}

// ─── Etapa 1 — 5 Hooks ───────────────────────────────────────────────────
const HOOKS_STAGE = `# Etapa 1 — 5 ângulos de gancho

Sua missão: gerar 5 ganchos DIFERENTES (não 5 versões da mesma frase) pro Reel pedido.

## Antes de gerar, em UMA pergunta curta verifique se faltar:
- Qual o tema/contexto do Reel?
- Qual a duração-alvo? (15s / 30s / 60s / 90s)

Se o usuário já deu, pula direto pros hooks.

## Como gerar os 5 hooks

Cada hook é diferente em ÂNGULO, não em redação:
- Ângulos clássicos: preguiça | autoridade | FOMO | controvérsia | antes/depois | dor escondida | listicle promete | story-driven (POV)
- Use NÚMEROS específicos quando couber ("perdeu R$ 87k" > "perdeu muito")
- Hook = primeira frase OU primeiro frame visual (descrição visual conta)

## Output

Resposta curta conversacional (1-2 frases) + JSON delimitado:

\`\`\`
---HOOKS---
{
  "title": "Título descritivo (vai pro kanban)",
  "theme": "tema curto, 1 frase",
  "target_duration": 30,
  "hooks": [
    { "angle": "preguiça", "hook": "frase ou descrição visual do gancho", "why": "por que esse ângulo funciona pra esse público" },
    { "angle": "autoridade", "hook": "...", "why": "..." },
    { "angle": "FOMO", "hook": "...", "why": "..." },
    { "angle": "controvérsia", "hook": "...", "why": "..." },
    { "angle": "antes/depois", "hook": "...", "why": "..." }
  ]
}
---HOOKS---
\`\`\`

PARE depois disso. Espere o usuário escolher.`;

// ─── Etapa 2 — Script com beats ──────────────────────────────────────────
const SCRIPT_STAGE = `# Etapa 2 — Roteiro beat-by-beat

O hook foi escolhido. Agora gera o roteiro completo, dividido em beats com timestamps.

## Formato de cada beat
- index: 0, 1, 2…
- start_seconds, end_seconds (números — soma = duração-alvo)
- visual: o que a câmera mostra (talking-head close, B-roll, on-screen text only, transição)
- on_camera_speech: O QUE A PESSOA FALA (vazio se for B-roll puro)
- on_screen_text: TEXTO QUE APARECE NA TELA (curto, máx 6 palavras por frame)
- broll_hint: opcional — descreve B-roll que precisa ser gravado/buscado

## Boas práticas
- Hook ocupa beat 0 (3 segundos no MÁXIMO)
- Beat 1: pattern interrupt — muda algo (cenário, ângulo, tom)
- Mantém ritmo: nenhum beat passa de 6-7 segundos
- Último beat: payoff + CTA setup
- Evita beats de pura fala estática — alterna talking-head com B-roll

## Output

\`\`\`
---SCRIPT---
{
  "chosen_hook_confirm": "repete o hook escolhido pra confirmar",
  "beats": [
    {
      "index": 0,
      "start_seconds": 0,
      "end_seconds": 3,
      "visual": "close-up no rosto, fundo desfocado",
      "on_camera_speech": "...",
      "on_screen_text": "...",
      "broll_hint": ""
    },
    ...
  ]
}
---SCRIPT---
\`\`\`

PARE. Aguarde aprovação.`;

// ─── Etapa 3 — Caption + CTA + hashtags ──────────────────────────────────
const CAPTION_STAGE = `# Etapa 3 — Caption + CTA + Hashtags

O roteiro foi aprovado. Gere a caption do Reel.

## O que produzir
- **caption** (50-200 palavras): gancho que repete a tensão do Reel + 1 ideia forte. Quebras de linha bem-vindas.
- **cta**: pedido específico ("Comenta TIME se … ", "Salva pra usar amanhã"). Não use "siga pra mais".
- **hashtags**: 8-15 mix de big/medium/small relevantes ao nicho.

## Output

\`\`\`
---CAPTION---
{
  "caption": "...",
  "cta": "...",
  "hashtags": ["#tag1", "#tag2", ...]
}
---CAPTION---
\`\`\`

PARE. Aguarde aprovação.`;

// ─── Etapa 4 — B-roll + Voice-over + Edit notes ──────────────────────────
const BROLL_STAGE = `# Etapa 4 — B-roll + Voice-over + Edit notes

Caption aprovada. Última etapa: lista de produção pra gravar/editar o Reel.

## O que produzir
- **broll_suggestions**: 3-7 itens. Cada item descreve UMA tomada de B-roll que o user precisa gravar ou buscar. Específico (não "imagem de produtividade", mas "close-up de mão digitando rápido em teclado mecânico, luz quente lateral").
- **voice_over_script**: TEXTO COMPLETO pra ler/gravar voice-over, frase por frase. Junta o que tá em cada beat.on_camera_speech mais transições naturais.
- **edit_notes**: 2-5 frases curtas de orientação de edição (música, transições, sound effects, jump cuts, color grading).

## Output

\`\`\`
---BROLL---
{
  "broll_suggestions": ["...", "..."],
  "voice_over_script": "Texto contínuo pra gravar.\\n\\nPode usar quebras de linha entre beats.",
  "edit_notes": "Música upbeat 110bpm. Jump cut a cada 1.5s. SFX whoosh nas transições."
}
---BROLL---
\`\`\`

PARE. Aguarde aprovação final.`;
