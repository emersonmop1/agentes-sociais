/**
 * Agent runner — generic chat orchestration shared by all chat-capable agents.
 *
 * Flow per turn:
 *   1. Persist user message
 *   2. Load conversation history (truncated)
 *   3. RECALL memories from query
 *   4. Build prompt (soul + brand + system + memories)
 *   5. Call LLM (sync OR streaming)
 *   6. Persist assistant message
 *   7. mark_used on recalled memory ids
 *   8. Background: detect+extract+store on (prev_assistant, this_user_msg)
 *   9. Audit log
 *
 * Note: the "learn from turn" step looks at the PREVIOUS assistant message
 * paired with THIS user message — that's the moment a correction reveals
 * itself ("you said X, but actually Y").
 */
import { getAgent, type RegisteredAgent } from "../agents/registry.js";
import { tx } from "../db/client.js";
import {
  appendMessage,
  listMessages,
  touchSession,
  type ChatMessageRow,
} from "../db/repositories/chat.js";
import { recordExecution } from "../db/repositories/executions.js";
import {
  createSession,
  getSession,
  updateSessionTitle,
} from "../db/repositories/sessions.js";
import { getDefaultProvider, type LLMMessage } from "../lib/llm/index.js";
import { logger } from "../lib/logger.js";
import { learnFromTurn, markUsed, recall } from "./memory-manager.js";
import { buildAgentPrompt } from "./prompt-builder.js";

export interface RunChatArgs {
  companyId: string;
  userId: string;
  agentSlug: string;
  /** Existing session, or null to create a fresh one. */
  sessionId?: string;
  userMessage: string;
}

export interface RunChatResult {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantContent: string;
  memoriesUsed: number;
  memoryLearned: boolean;
  model: string;
  tokens: { input?: number; output?: number };
}

/** Truncate history to the last N turns (user+assistant) for the prompt. */
const HISTORY_TURNS = 20;

function toLLMMessages(rows: ChatMessageRow[]): LLMMessage[] {
  return rows.map((m) => ({
    role: m.role === "system" ? "user" : m.role,
    content: m.content,
  }));
}

async function ensureSession(args: {
  companyId: string;
  userId: string;
  agent: RegisteredAgent;
  sessionId?: string;
}): Promise<{ id: string; isNew: boolean }> {
  if (args.sessionId) {
    const existing = await getSession(undefined, args.sessionId, args.companyId);
    if (!existing) throw new Error(`session ${args.sessionId} not found`);
    if (existing.agent_slug !== args.agent.slug) {
      throw new Error(
        `session ${args.sessionId} is for agent ${existing.agent_slug}, not ${args.agent.slug}`,
      );
    }
    return { id: existing.id, isNew: false };
  }
  const fresh = await createSession(undefined, {
    companyId: args.companyId,
    userId: args.userId,
    agentSlug: args.agent.slug,
    sessionType: args.agent.defaultSessionType,
  });
  return { id: fresh.id, isNew: true };
}

/** First-message heuristic title: first 60 chars of user query. */
function inferTitle(userMessage: string): string {
  const t = userMessage.trim().split("\n")[0]?.slice(0, 60) ?? "";
  return t.length > 0 ? t : "Nova conversa";
}

// ─── Sync chat ───────────────────────────────────────────────────────────

export async function runChat(args: RunChatArgs): Promise<RunChatResult> {
  const agent = getAgent(args.agentSlug);
  if (!agent) throw new Error(`unknown agent: ${args.agentSlug}`);
  if (!agent.isGenericChat) {
    throw new Error(`agent ${agent.slug} is not registered for generic chat`);
  }

  const startedAt = Date.now();

  const { id: sessionId, isNew } = await ensureSession({
    companyId: args.companyId,
    userId: args.userId,
    agent,
    sessionId: args.sessionId,
  });

  // 1. Persist user msg + capture prior history (for learning detection)
  const priorHistory = await listMessages(undefined, sessionId, HISTORY_TURNS * 2);
  const priorAssistantMsg = [...priorHistory].reverse().find((m) => m.role === "assistant");

  const userMessageId = await appendMessage(undefined, {
    sessionId,
    role: "user",
    content: args.userMessage,
  });
  if (isNew) {
    await updateSessionTitle(undefined, sessionId, inferTitle(args.userMessage));
  }

  // 2-3. RECALL memories
  const { memories, keywords } = await recall({
    companyId: args.companyId,
    agentSlug: agent.slug,
    query: args.userMessage,
  });

  // 4. Build prompt
  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: agent.soul,
    systemPrompt: agent.systemPrompt,
    memories,
  });

  // 5. Call LLM
  const history = await listMessages(undefined, sessionId, HISTORY_TURNS * 2);
  const llmMessages = toLLMMessages(history);

  const response = await getDefaultProvider().chat(llmMessages, {
    system: systemPrompt,
    tier: agent.defaultTier,
    temperature: agent.defaultTemperature,
    maxOutputTokens: agent.defaultMaxTokens,
  });

  // 6. Persist assistant msg + touch session
  const assistantMessageId = await tx(async (client) => {
    const id = await appendMessage(client, {
      sessionId,
      role: "assistant",
      content: response.content,
      tokensUsed: response.tokens,
      providerModel: response.model,
    });
    await touchSession(client, sessionId);
    return id;
  });

  // 7. mark_used on recalled memories (fire-and-forget — fast op)
  if (memories.length > 0) {
    void markUsed(memories.map((m) => m.id)).catch((e) =>
      logger.warn({ err: (e as Error).message }, "markUsed failed"),
    );
  }

  // 8. Background learning: was the user's message a correction of the prior assistant msg?
  let learned = false;
  if (priorAssistantMsg) {
    void (async () => {
      const memory = await learnFromTurn({
        companyId: args.companyId,
        agentSlug: agent.slug,
        sessionId,
        assistantMessage: priorAssistantMsg.content,
        userFollowup: args.userMessage,
      });
      if (memory) learned = true;
    })().catch((e) =>
      logger.warn({ err: (e as Error).message }, "learnFromTurn failed"),
    );
  }

  // 9. Audit
  void recordExecution(undefined, {
    companyId: args.companyId,
    agentSlug: agent.slug,
    sessionId,
    trigger: "chat",
    provider: "gemini",
    model: response.model,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    latencyMs: Date.now() - startedAt,
    status: "ok",
    memoriesRecalled: memories.length,
    metadata: { keywords },
  });

  return {
    sessionId,
    userMessageId,
    assistantMessageId,
    assistantContent: response.content,
    memoriesUsed: memories.length,
    memoryLearned: learned,
    model: response.model,
    tokens: response.tokens,
  };
}

// ─── Streaming chat ──────────────────────────────────────────────────────

export interface StreamChunk {
  type: "ready" | "chunk" | "done" | "error";
  /** For "ready": session metadata */
  sessionId?: string;
  userMessageId?: string;
  /** For "chunk": incremental delta */
  delta?: string;
  /** For "done": final summary */
  assistantMessageId?: string;
  content?: string;
  memoriesUsed?: number;
  /** For "error" */
  message?: string;
}

/**
 * Async generator that yields StreamChunk events. Caller serializes them as
 * SSE in the route handler.
 */
export async function* runChatStream(args: RunChatArgs): AsyncGenerator<StreamChunk> {
  const agent = getAgent(args.agentSlug);
  if (!agent) {
    yield { type: "error", message: `unknown agent: ${args.agentSlug}` };
    return;
  }
  if (!agent.isGenericChat) {
    yield { type: "error", message: `agent ${agent.slug} not registered for chat` };
    return;
  }

  const startedAt = Date.now();

  let sessionId: string;
  let isNew: boolean;
  try {
    const r = await ensureSession({
      companyId: args.companyId,
      userId: args.userId,
      agent,
      sessionId: args.sessionId,
    });
    sessionId = r.id;
    isNew = r.isNew;
  } catch (e) {
    yield { type: "error", message: (e as Error).message };
    return;
  }

  const priorHistory = await listMessages(undefined, sessionId, HISTORY_TURNS * 2);
  const priorAssistantMsg = [...priorHistory].reverse().find((m) => m.role === "assistant");

  const userMessageId = await appendMessage(undefined, {
    sessionId,
    role: "user",
    content: args.userMessage,
  });
  if (isNew) {
    await updateSessionTitle(undefined, sessionId, inferTitle(args.userMessage));
  }

  yield { type: "ready", sessionId, userMessageId };

  // RECALL + prompt
  const { memories, keywords } = await recall({
    companyId: args.companyId,
    agentSlug: agent.slug,
    query: args.userMessage,
  });
  const systemPrompt = await buildAgentPrompt({
    companyId: args.companyId,
    soul: agent.soul,
    systemPrompt: agent.systemPrompt,
    memories,
  });
  const history = await listMessages(undefined, sessionId, HISTORY_TURNS * 2);
  const llmMessages = toLLMMessages(history);

  // Stream LLM
  const provider = getDefaultProvider();
  let fullContent = "";
  let model = "";
  let tokens: { input?: number; output?: number } = {};
  try {
    const stream = provider.stream(llmMessages, {
      system: systemPrompt,
      tier: agent.defaultTier,
      temperature: agent.defaultTemperature,
      maxOutputTokens: agent.defaultMaxTokens,
    });
    let last = await stream.next();
    while (!last.done) {
      const chunk = last.value;
      fullContent = chunk.content;
      yield { type: "chunk", delta: chunk.delta };
      last = await stream.next();
    }
    const final = last.value;
    fullContent = final.content;
    model = final.model;
    tokens = final.tokens;
  } catch (err) {
    yield { type: "error", message: (err as Error).message };
    void recordExecution(undefined, {
      companyId: args.companyId,
      agentSlug: agent.slug,
      sessionId,
      trigger: "chat_stream",
      provider: "gemini",
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: (err as Error).message,
      memoriesRecalled: memories.length,
    });
    return;
  }

  // Persist assistant
  const assistantMessageId = await tx(async (client) => {
    const id = await appendMessage(client, {
      sessionId,
      role: "assistant",
      content: fullContent,
      tokensUsed: tokens,
      providerModel: model,
    });
    await touchSession(client, sessionId);
    return id;
  });

  yield {
    type: "done",
    sessionId,
    assistantMessageId,
    content: fullContent,
    memoriesUsed: memories.length,
  };

  // Background work
  if (memories.length > 0) {
    void markUsed(memories.map((m) => m.id)).catch(() => undefined);
  }
  if (priorAssistantMsg) {
    void learnFromTurn({
      companyId: args.companyId,
      agentSlug: agent.slug,
      sessionId,
      assistantMessage: priorAssistantMsg.content,
      userFollowup: args.userMessage,
    }).catch(() => undefined);
  }
  void recordExecution(undefined, {
    companyId: args.companyId,
    agentSlug: agent.slug,
    sessionId,
    trigger: "chat_stream",
    provider: "gemini",
    model,
    tokensInput: tokens.input,
    tokensOutput: tokens.output,
    latencyMs: Date.now() - startedAt,
    status: "ok",
    memoriesRecalled: memories.length,
    metadata: { keywords },
  });
}
