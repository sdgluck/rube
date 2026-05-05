import type { LlmClient, LlmConfig } from "./types.ts";
import { LlmConfigError } from "./types.ts";
import { createAnthropicClient } from "./providers/anthropic.ts";
import { createOpenAiClient, createGenericOpenAiCompatibleClient } from "./providers/openai.ts";
import { createGeminiClient } from "./providers/gemini.ts";
import { createOllamaClient } from "./providers/ollama.ts";

export function createLlmClient(config: LlmConfig): LlmClient {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicClient(config);
    case "openai":
      return createOpenAiClient(config);
    case "gemini":
      return createGeminiClient(config);
    case "ollama":
      return createOllamaClient(config);
    case "openai-compatible":
      return createGenericOpenAiCompatibleClient(config);
    default: {
      const exhaustive: never = config.provider;
      throw new LlmConfigError(`Unknown LLM provider: ${exhaustive as string}`);
    }
  }
}
