/**
 * LLM provider abstraction. Concrete implementations live in ./providers.
 *
 * Why an abstraction now?
 *   • The plan calls for Gemini today, with Anthropic / OpenAI as future
 *     fallbacks. Keeping a stable interface lets us switch providers per
 *     agent (e.g. Pro for ideation, Flash for memory extraction) without
 *     leaking SDK details.
 *   • Tests can stub the provider with a fake one.
 */

export type Role = "user" | "assistant" | "system";

export interface LLMMessage {
  role: Role;
  content: string;
}

export interface LLMTokens {
  input?: number;
  output?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens: LLMTokens;
  finish_reason?: string;
  raw?: unknown;
}

export interface LLMStreamChunk {
  /** Incremental text delta. Concatenate to assemble the full response. */
  delta: string;
  /** Total content so far. */
  content: string;
}

export interface LLMStreamFinal {
  content: string;
  model: string;
  tokens: LLMTokens;
  finish_reason?: string;
}

export interface ChatOptions {
  /** System instructions. Stable across the conversation. */
  system?: string;
  /** Sampling — between 0 and 2 in Gemini. 0 = deterministic. */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxOutputTokens?: number;
  /** Tier of model: "flash" for fast/cheap, "pro" for quality/expensive. */
  tier?: "flash" | "pro";
  /** When set, force JSON output (Gemini's responseSchema). */
  responseSchema?: object;
  /**
   * For Gemini 2.5+: disable internal "thinking" tokens. Set to 0 for
   * structured-output tasks where you want the full token budget for the
   * actual answer, not for hidden reasoning.
   */
  thinkingBudget?: number;
}

export interface LLMProvider {
  readonly name: string;
  /** Single-shot chat. Returns the full response. */
  chat(messages: LLMMessage[], opts?: ChatOptions): Promise<LLMResponse>;
  /** Streaming chat — yields incremental chunks then a final summary. */
  stream(
    messages: LLMMessage[],
    opts?: ChatOptions,
  ): AsyncGenerator<LLMStreamChunk, LLMStreamFinal, void>;
  /** Health probe — does the API key work? Used by /api/health in prod. */
  healthCheck(): Promise<boolean>;
}
