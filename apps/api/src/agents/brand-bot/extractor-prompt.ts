/**
 * Secondary prompt that runs AFTER each user turn.
 * Goal: extract structured deltas from the latest message + agent reply,
 * to merge into companies.onboarding_draft.
 *
 * Uses Gemini Flash with JSON schema enforcement so we can trust the shape.
 *
 * The prompt is intentionally narrow: only return fields the user JUST
 * mentioned. Don't invent. Don't fill from prior context. The merge logic
 * on the server preserves prior values.
 */

export interface ExtractorVars {
  /** The text the user just sent. */
  user_message: string;
  /** The text BrandBot replied (gives context for what was being discussed). */
  agent_reply: string;
  /** Current state of the draft — already-known fields. */
  current_draft_json: string;
}

export const EXTRACTOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    brand_name: { type: "string", nullable: true },
    niche: { type: "string", nullable: true },
    voice_tone: { type: "array", items: { type: "string" } },
    voice_examples: { type: "array", items: { type: "string" } },
    icp_description: { type: "string", nullable: true },
    target_audience_age: { type: "string", nullable: true },
    target_audience_pain: { type: "string", nullable: true },
    primary_color: { type: "string", nullable: true },
    secondary_color: { type: "string", nullable: true },
    accent_color: { type: "string", nullable: true },
    instagram_handle: { type: "string", nullable: true },
    tiktok_handle: { type: "string", nullable: true },
    youtube_channel: { type: "string", nullable: true },
    forbidden_terms: { type: "array", items: { type: "string" } },
    signature_phrases: { type: "array", items: { type: "string" } },
  },
} as const;

export function renderExtractorPrompt(vars: ExtractorVars): string {
  return `Você é um extrator de dados estruturados de marca.

Analise a última mensagem do usuário (no contexto da conversa) e extraia campos da marca que ele mencionou. Seja AGRESSIVO em capturar menções explícitas — não deixe passar.

# Regras de extração

## brand_name (CRÍTICO — sempre extraia se mencionado)
Se o usuário disser:
  - "minha marca/empresa/produto/negócio chama X" / "chamada X" / "se chama X" → brand_name = X
  - "chama X" / "é X" / "é o X" como nome da empresa → brand_name = X
  - "tenho um/uma X" onde X é nome próprio (capitalizado) → brand_name = X
  - "X é minha [empresa/marca/produto]" → brand_name = X
Capitalize corretamente (DevClub, não devclub). Tire @ ou prefixos.

## niche (CRÍTICO — sempre extraia)
O QUE o usuário faz e PRA QUEM. Frase curta (5-15 palavras).
Exemplos:
  - "faço mentoria de programação pra devs iniciantes" → niche = "mentoria de programação pra devs iniciantes"
  - "vendo cursos de inglês online" → niche = "cursos de inglês online"
  - "sou nutricionista clínica" → niche = "nutrição clínica"

## voice_tone
Tags curtas em pt-BR. Ex: "direto", "casual", "técnico", "motivacional", "irônico", "didático", "objetivo".

## voice_examples
APENAS frases TEXTUAIS que o usuário escreveu OU mencionou que diria. Não invente, não parafraseie.

## forbidden_terms
Palavras/expressões que o usuário disse que NÃO QUER ver na copy dele.
Ex: "Sem 'jornada' nem 'sucesso'" → forbidden_terms = ["jornada", "sucesso"]

## signature_phrases
Bordões/frases recorrentes que o usuário disse usar. Pode coincidir com voice_examples.

## icp_description
1 frase resumindo o cliente ideal. Ex: "devs juniors-plenos querendo dobrar o salário".

## target_audience_age, target_audience_pain
Extraia separadamente se o usuário falou. age = faixa etária ("22-35 anos"). pain = principal dor.

## Cores
Só retorne se for hex válido (#RRGGBB) que o usuário mandou OU nome óbvio ("verde escuro" não conta, "verde do Spotify" não conta, mas "#22c55e" sim).

## Handles
Formato "@usuario". Sem URL. Se o usuário disse "estamos só no Instagram: @x", extraia instagram_handle="@x".

# Anti-regras
- NÃO repita itens que já estão no current_draft (o merge no servidor cuida disso, mas evite duplicar).
- NÃO invente: se não mencionou, OMITA o campo (ou retorne array vazio para arrays).
- NÃO copie informações de turnos anteriores — só do turno atual.

# Contexto da troca
Pergunta anterior da BrandBot:
"${vars.agent_reply.replace(/"/g, '\\"').slice(0, 800)}"

Resposta do usuário (analise ESTA mensagem):
"${vars.user_message.replace(/"/g, '\\"').slice(0, 1500)}"

Draft já coletado em turnos anteriores (NÃO RE-EXTRAIA estes):
${vars.current_draft_json}

Retorne SOMENTE o JSON com os campos extraídos NESTA mensagem. Sem texto extra.`;
}

/** Map of extractor output → onboarding_draft fields, with merge semantics. */
export interface ExtractorOutput {
  brand_name?: string;
  niche?: string;
  voice_tone?: string[];
  voice_examples?: string[];
  icp_description?: string;
  target_audience_age?: string;
  target_audience_pain?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  instagram_handle?: string;
  tiktok_handle?: string;
  youtube_channel?: string;
  forbidden_terms?: string[];
  signature_phrases?: string[];
}
