/**
 * Memory Manager — self-learning pipeline.
 *
 *   query → RECALL keywords → ILIKE → top-K
 *           ↓                              ↑
 *           prompt → agent reply → next user msg
 *           ↓
 *           DETECT (LLM): is the next msg a correction?
 *           ↓ yes (confidence ≥ 0.7)
 *           EXTRACT (LLM): structured memory
 *           ↓
 *           STORE (dedupe via 5-keyword AND)
 *
 * Direct port of clubhub §7. Designed so DETECT + EXTRACT can run in the
 * background after the chat reply is delivered (non-blocking).
 */

import {
  findSimilar,
  insertMemory,
  markUsed as markUsedDb,
  recall as recallDb,
  updateMemory,
  type MemoryRow,
  type MemorySource,
  type MemoryType,
} from "../db/repositories/memories.js";
import { getDefaultProvider } from "../lib/llm/index.js";
import { logger } from "../lib/logger.js";
import { extractKeywords } from "./stopwords.js";

// ─── RECALL ──────────────────────────────────────────────────────────────

export interface RecallResult {
  memories: MemoryRow[];
  /** Keywords actually used for the search — useful for debugging. */
  keywords: string[];
}

export async function recall(args: {
  companyId: string;
  agentSlug: string;
  query: string;
  limit?: number;
}): Promise<RecallResult> {
  const keywords = extractKeywords(args.query);
  const memories = await recallDb(undefined, {
    companyId: args.companyId,
    agentSlug: args.agentSlug,
    keywords,
    limit: args.limit ?? 10,
  });
  return { memories, keywords };
}

/** Increment use counters for memories that were actually injected into a prompt. */
export async function markUsed(ids: string[]): Promise<void> {
  return markUsedDb(undefined, ids);
}

// ─── Format injected block ───────────────────────────────────────────────

/**
 * Render the <learned_memories>…</learned_memories> block.
 * Groups by type so the LLM can prioritize corrections.
 * Returns "" when there's nothing to inject (caller should skip the block).
 */
export function formatMemoriesForPrompt(memories: MemoryRow[]): string {
  if (memories.length === 0) return "";
  const groups: Record<MemoryType, MemoryRow[]> = {
    correction: [],
    knowledge: [],
    pattern: [],
    preference: [],
  };
  for (const m of memories) groups[m.memory_type].push(m);

  const sections: string[] = [];
  if (groups.correction.length > 0) {
    sections.push(
      "## CORREÇÕES IMPORTANTES (sempre seguir)\n" +
        groups.correction.map((m) => `- ${m.content}`).join("\n"),
    );
  }
  if (groups.knowledge.length > 0) {
    sections.push(
      "## CONHECIMENTOS\n" + groups.knowledge.map((m) => `- ${m.content}`).join("\n"),
    );
  }
  if (groups.pattern.length > 0) {
    sections.push(
      "## PADRÕES DE COMPORTAMENTO\n" + groups.pattern.map((m) => `- ${m.content}`).join("\n"),
    );
  }
  if (groups.preference.length > 0) {
    sections.push(
      "## PREFERÊNCIAS\n" + groups.preference.map((m) => `- ${m.content}`).join("\n"),
    );
  }
  return `<learned_memories>\n\n${sections.join("\n\n")}\n\n</learned_memories>`;
}

// ─── DETECT correction ───────────────────────────────────────────────────

interface DetectResult {
  is_correction: boolean;
  confidence: number;
  correction_type?: "tone" | "content" | "knowledge" | "approach" | null;
  summary?: string;
}

const DETECT_SCHEMA = {
  type: "object",
  properties: {
    is_correction: { type: "boolean" },
    confidence: { type: "number" },
    correction_type: {
      type: "string",
      enum: ["tone", "content", "knowledge", "approach", "null"],
    },
    summary: { type: "string" },
  },
  required: ["is_correction", "confidence"],
} as const;

const DETECT_THRESHOLD = 0.7;

export async function detectCorrection(args: {
  assistantMessage: string;
  userFollowup: string;
}): Promise<DetectResult | null> {
  const prompt = `Analise esta troca de mensagens e determine se o USUÁRIO está corrigindo o ASSISTENTE.

Mensagem anterior do assistente:
"${args.assistantMessage.slice(0, 1500)}"

Resposta do usuário:
"${args.userFollowup.slice(0, 1500)}"

Uma correção é quando o usuário:
- Diz que a resposta está errada ou inadequada
- Mostra como deveria ter respondido
- Pede pra mudar tom, abordagem ou conteúdo
- Diz "não faz X" ou "faz Y ao invés"
- Dá um exemplo de resposta melhor
- Ensina algo novo que o agente deveria saber

NÃO é correção quando o usuário só:
- Faz uma nova pergunta sem comentar a anterior
- Agradece sem mais nada
- Continua o assunto naturalmente

Responda APENAS com JSON: {"is_correction": true|false, "confidence": 0.0-1.0, "correction_type": "tone|content|knowledge|approach|null", "summary": "uma frase"}`;

  try {
    const r = await getDefaultProvider().chat(
      [{ role: "user", content: prompt }],
      {
        tier: "flash",
        temperature: 0.1,
        maxOutputTokens: 512,
        responseSchema: DETECT_SCHEMA,
        thinkingBudget: 0, // structured output, skip thinking
      },
    );
    const parsed = JSON.parse(r.content) as DetectResult;
    if (!parsed.is_correction || parsed.confidence < DETECT_THRESHOLD) return null;
    return parsed;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "memory.detect failed");
    return null;
  }
}

// ─── EXTRACT memory ──────────────────────────────────────────────────────

interface ExtractResult {
  memory_content: string;
  category: string;
  memory_type: MemoryType;
  priority: number;
  search_keywords: string[];
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    memory_content: { type: "string" },
    category: { type: "string" },
    memory_type: { type: "string", enum: ["correction", "knowledge", "pattern", "preference"] },
    priority: { type: "integer" },
    search_keywords: { type: "array", items: { type: "string" } },
  },
  required: ["memory_content", "memory_type", "priority", "search_keywords"],
} as const;

export async function extractMemory(args: {
  context: string;
  correction: string;
  correctionType?: string | null;
}): Promise<ExtractResult | null> {
  const prompt = `Extraia a lição aprendida desta correção feita pelo usuário ao assistente.

Contexto (mensagem do agente que motivou a correção):
"${args.context.slice(0, 1500)}"

Correção do usuário:
"${args.correction.slice(0, 1500)}"

${args.correctionType ? `Tipo de correção detectado: ${args.correctionType}\n` : ""}

Crie uma memória clara e acionável que o assistente DEVE seguir no futuro. Formato preferido pra memory_content:
"Quando [situação], [ação correta]. Exemplo: ..."

Regras:
- memory_type:
  - "correction": "não faz X / use Y ao invés"
  - "preference": "prefere X em vez de Y"
  - "pattern": "geralmente formata Z assim"
  - "knowledge": "X é true / nossa política é Y"
- priority: 1-10. Correções fortes = 8-9. Preferências moderadas = 5-7. Conhecimentos triviais = 3-5.
- search_keywords: 3-8 palavras-chave em PT-BR (lowercased, sem stopwords) que ajudem a achar essa memória depois.
- category: 1 palavra ou frase curta (ex: "tom", "format", "tabu", "framework").

Responda APENAS com JSON.`;

  try {
    const r = await getDefaultProvider().chat(
      [{ role: "user", content: prompt }],
      {
        tier: "flash",
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseSchema: EXTRACT_SCHEMA,
        thinkingBudget: 0,
      },
    );
    const parsed = JSON.parse(r.content) as ExtractResult;
    parsed.priority = Math.max(1, Math.min(10, parsed.priority));
    return parsed;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "memory.extract failed");
    return null;
  }
}

// ─── STORE ───────────────────────────────────────────────────────────────

export interface StoreArgs {
  companyId: string;
  agentSlug: string;
  content: string;
  memoryType?: MemoryType;
  source?: MemorySource;
  category?: string;
  priority?: number;
  searchKeywords: string[];
  sessionId?: string;
}

/**
 * Store with dedupe. If a similar memory exists (5-keyword AND match):
 *   • Update its content (latest version wins)
 *   • Escalate priority = max(old, new)
 *   • Return existing row
 * Otherwise insert a fresh row.
 */
export async function store(args: StoreArgs): Promise<MemoryRow> {
  const searchText = args.searchKeywords.join(" ").toLowerCase();
  const existing = await findSimilar(undefined, {
    companyId: args.companyId,
    agentSlug: args.agentSlug,
    keywords: args.searchKeywords,
  });

  if (existing) {
    return updateMemory(undefined, {
      id: existing.id,
      content: args.content,
      priority: Math.max(existing.priority, args.priority ?? existing.priority),
      searchText,
    });
  }

  return insertMemory(undefined, {
    companyId: args.companyId,
    agentSlug: args.agentSlug,
    content: args.content,
    category: args.category ?? null,
    memoryType: args.memoryType ?? "knowledge",
    source: args.source ?? "user_correction",
    priority: args.priority ?? 5,
    searchText,
    sessionId: args.sessionId ?? null,
  });
}

// ─── Feedback path (👍 / 👎) ─────────────────────────────────────────────

const FEEDBACK_EXTRACT_SCHEMA = EXTRACT_SCHEMA;

export async function extractFeedbackMemory(args: {
  assistantMessage: string;
  userPriorMessage: string;
  isPositive: boolean;
  comment?: string;
  sectionContent?: string;
}): Promise<ExtractResult | null> {
  const prompt = `Extraia uma memória orientada a comportamento a partir deste feedback do usuário.

Pergunta/contexto do usuário:
"${args.userPriorMessage.slice(0, 1000)}"

Resposta do assistente:
"${args.assistantMessage.slice(0, 1500)}"

${args.sectionContent ? `Trecho específico que o usuário sinalizou:\n"${args.sectionContent.slice(0, 800)}"\n` : ""}

Sinal: ${args.isPositive ? "👍 POSITIVO" : "👎 NEGATIVO"}.
${args.comment ? `Comentário do usuário: "${args.comment.slice(0, 500)}"\n` : ""}

Regras:
- Se POSITIVO → memory_type = "pattern" (capture o que deu certo, prioridade ~6).
- Se NEGATIVO → memory_type = "correction" (descreva o que evitar, prioridade ~8).
- memory_content: ação clara pro futuro. Ex: "Ao gerar X, fazer Y porque Z."
- search_keywords: 3-8 palavras-chave em PT-BR.

Responda APENAS com JSON.`;

  try {
    const r = await getDefaultProvider().chat(
      [{ role: "user", content: prompt }],
      {
        tier: "flash",
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseSchema: FEEDBACK_EXTRACT_SCHEMA,
        thinkingBudget: 0,
      },
    );
    const parsed = JSON.parse(r.content) as ExtractResult;
    parsed.priority = Math.max(1, Math.min(10, parsed.priority));
    parsed.memory_type = args.isPositive ? "pattern" : "correction";
    return parsed;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "memory.extractFeedback failed");
    return null;
  }
}

// ─── End-to-end pipeline (called from chat handler) ──────────────────────

export interface LearnFromTurnArgs {
  companyId: string;
  agentSlug: string;
  sessionId: string;
  /** Last assistant message that got "corrected" by the next user message. */
  assistantMessage: string;
  /** The user's reply to that — possibly a correction. */
  userFollowup: string;
}

/**
 * Run DETECT → EXTRACT → STORE in one call. Designed to be invoked AFTER the
 * chat reply was already delivered (so it doesn't block the SSE stream).
 *
 * Returns the new/updated memory if learning occurred, null otherwise.
 */
export async function learnFromTurn(
  args: LearnFromTurnArgs,
): Promise<MemoryRow | null> {
  const detection = await detectCorrection({
    assistantMessage: args.assistantMessage,
    userFollowup: args.userFollowup,
  });
  if (!detection) return null;

  const extracted = await extractMemory({
    context: args.assistantMessage,
    correction: args.userFollowup,
    correctionType: detection.correction_type ?? null,
  });
  if (!extracted) return null;

  const memory = await store({
    companyId: args.companyId,
    agentSlug: args.agentSlug,
    sessionId: args.sessionId,
    content: extracted.memory_content,
    memoryType: extracted.memory_type,
    source: "user_correction",
    category: extracted.category,
    priority: extracted.priority,
    searchKeywords: extracted.search_keywords,
  });

  logger.info(
    {
      companyId: args.companyId,
      agentSlug: args.agentSlug,
      memoryId: memory.id,
      type: extracted.memory_type,
      priority: extracted.priority,
    },
    "memory.learned",
  );
  return memory;
}
