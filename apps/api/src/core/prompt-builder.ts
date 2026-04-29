import type { MemoryRow } from "../db/repositories/memories.js";
import { buildBrandContext } from "./brand-context.js";
import { formatMemoriesForPrompt } from "./memory-manager.js";

/**
 * Standard agent prompt block order (mirror of clubhub §10.1):
 *
 *   <soul>...</soul>                        — who the agent IS
 *   <brand-context>...</brand-context>      — the user's brand identity
 *   <instructions>...</instructions>        — what the agent DOES (system prompt)
 *   <extra-context>...</extra-context>      — agent-specific context
 *   <learned_memories>...</learned_memories> — accumulated lessons
 *
 * All sections are optional; empty ones get skipped (we don't want stray
 * "<soul></soul>" dropping into the prompt).
 */
export interface BuildPromptArgs {
  /** Agent identity block (from agents/<slug>/soul.ts) */
  soul: string;
  /** Agent capabilities block (from agents/<slug>/system-prompt.ts) */
  systemPrompt: string;
  /** Memories already retrieved via RECALL */
  memories: MemoryRow[];
  /** Extra context, agent-specific (e.g. last 500 post titles for InstaCreator) */
  extraContext?: string;
  /** Brand context — passed in. Use buildAgentPrompt for the convenience wrapper. */
  brandContext: string;
}

export function buildPrompt(args: BuildPromptArgs): string {
  const parts: string[] = [];

  if (args.soul) parts.push(`<soul>\n${args.soul.trim()}\n</soul>`);
  if (args.brandContext) parts.push(args.brandContext); // already wrapped in <brand-context>
  if (args.systemPrompt) {
    parts.push(`<instructions>\n${args.systemPrompt.trim()}\n</instructions>`);
  }
  if (args.extraContext && args.extraContext.trim().length > 0) {
    parts.push(args.extraContext.startsWith("<")
      ? args.extraContext
      : `<extra-context>\n${args.extraContext.trim()}\n</extra-context>`);
  }
  const memBlock = formatMemoriesForPrompt(args.memories);
  if (memBlock) parts.push(memBlock);

  return parts.join("\n\n");
}

/** Convenience wrapper: also fetches the brand context for the company. */
export async function buildAgentPrompt(args: {
  companyId: string;
  soul: string;
  systemPrompt: string;
  memories: MemoryRow[];
  extraContext?: string;
}): Promise<string> {
  const brandContext = await buildBrandContext(args.companyId);
  return buildPrompt({
    soul: args.soul,
    systemPrompt: args.systemPrompt,
    memories: args.memories,
    extraContext: args.extraContext,
    brandContext,
  });
}
