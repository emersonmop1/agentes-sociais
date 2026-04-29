import { GeminiProvider } from "./providers/gemini.js";
import type { LLMProvider } from "./types.js";

export type { ChatOptions, LLMMessage, LLMProvider, LLMResponse, LLMStreamChunk, LLMStreamFinal, Role } from "./types.js";

let _default: LLMProvider | null = null;

/** Default provider is Gemini for v1. Reused as a singleton. */
export function getDefaultProvider(): LLMProvider {
  if (_default) return _default;
  _default = new GeminiProvider();
  return _default;
}

/** Reset the default provider — used in tests. */
export function _resetDefaultProvider() {
  _default = null;
}

export { GeminiProvider };
