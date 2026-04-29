import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import { loadEnv } from "../../../env.js";
import { logger } from "../../logger.js";
import type {
  ChatOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamFinal,
} from "../types.js";

const FLASH_MODEL = "gemini-2.5-flash";
const PRO_MODEL = "gemini-2.5-pro";

function pickModel(tier: ChatOptions["tier"]) {
  return tier === "pro" ? PRO_MODEL : FLASH_MODEL;
}

/**
 * Gemini SDK wants the conversation as `Content[]` with role "user" or
 * "model" — there's no "assistant"/"system" role. System instructions go
 * into the model's `systemInstruction` field. We translate here.
 */
function toGeminiContents(messages: LLMMessage[]): Content[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function extractSystem(messages: LLMMessage[], opts: ChatOptions): string | undefined {
  if (opts.system) return opts.system;
  // Allow callers to push system messages via the messages array — Gemini
  // can't take them inline, so we collapse them into systemInstruction.
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content);
  return sys.length > 0 ? sys.join("\n\n") : undefined;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const env = loadEnv();
    const key = apiKey ?? env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is required to use GeminiProvider. " +
          "Set it in .env or pass it explicitly.",
      );
    }
    this.client = new GoogleGenerativeAI(key);
  }

  async chat(messages: LLMMessage[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const modelId = pickModel(opts.tier);
    const model = this.client.getGenerativeModel({
      model: modelId,
      ...(extractSystem(messages, opts) && {
        systemInstruction: extractSystem(messages, opts),
      }),
      generationConfig: {
        ...(opts.temperature !== undefined && { temperature: opts.temperature }),
        ...(opts.maxOutputTokens !== undefined && {
          maxOutputTokens: opts.maxOutputTokens,
        }),
        ...(opts.responseSchema && {
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema as never,
        }),
        // Gemini 2.5 thinking budget — pass 0 for fast structured output
        ...(opts.thinkingBudget !== undefined && {
          thinkingConfig: { thinkingBudget: opts.thinkingBudget },
        }),
      } as never,
    });

    const contents = toGeminiContents(messages);
    if (contents.length === 0) {
      throw new Error("Gemini chat requires at least one user message");
    }

    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      content: text,
      model: modelId,
      tokens: {
        input: usage?.promptTokenCount,
        output: usage?.candidatesTokenCount,
      },
      finish_reason: response.candidates?.[0]?.finishReason,
      raw: response,
    };
  }

  async *stream(
    messages: LLMMessage[],
    opts: ChatOptions = {},
  ): AsyncGenerator<LLMStreamChunk, LLMStreamFinal, void> {
    const modelId = pickModel(opts.tier);
    const model = this.client.getGenerativeModel({
      model: modelId,
      ...(extractSystem(messages, opts) && {
        systemInstruction: extractSystem(messages, opts),
      }),
      generationConfig: {
        ...(opts.temperature !== undefined && { temperature: opts.temperature }),
        ...(opts.maxOutputTokens !== undefined && {
          maxOutputTokens: opts.maxOutputTokens,
        }),
        ...(opts.thinkingBudget !== undefined && {
          thinkingConfig: { thinkingBudget: opts.thinkingBudget },
        }),
      } as never,
    });

    const contents = toGeminiContents(messages);
    if (contents.length === 0) {
      throw new Error("Gemini stream requires at least one user message");
    }

    const result = await model.generateContentStream({ contents });
    let acc = "";

    for await (const chunk of result.stream) {
      const delta = chunk.text();
      if (!delta) continue;
      acc += delta;
      yield { delta, content: acc };
    }

    // Final summary — usage metadata is only available after the full
    // stream has been consumed.
    const final = await result.response;
    const usage = final.usageMetadata;
    return {
      content: acc,
      model: modelId,
      tokens: {
        input: usage?.promptTokenCount,
        output: usage?.candidatesTokenCount,
      },
      finish_reason: final.candidates?.[0]?.finishReason,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const r = await this.chat([{ role: "user", content: "ping" }], {
        tier: "flash",
        maxOutputTokens: 8,
      });
      return r.content.length > 0;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "gemini health check failed");
      return false;
    }
  }
}
