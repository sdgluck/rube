import type { LlmClient, LlmConfig } from "./types.ts";
import { LlmConfigError } from "./types.ts";
import { createAnthropicClient } from "./providers/anthropic.ts";
import { createOpenAiClient, createGenericOpenAiCompatibleClient } from "./providers/openai.ts";
import { createGeminiClient } from "./providers/gemini.ts";
import { createOllamaClient, listOllamaModels } from "./providers/ollama.ts";

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

/**
 * The models actually available, where that is the useful list: on a
 * self-hosted Ollama the only models that work are the ones pulled, and a
 * static preset list is mostly names that 404. Null for hosted providers,
 * whose presets are the curated short list.
 *
 * A free function rather than a client method so wrappers around `LlmClient`
 * (usage tracking) don't have to forward it.
 */
export async function listModels(
  config: Pick<LlmConfig, "provider" | "baseUrl">,
  signal?: AbortSignal,
): Promise<string[] | null> {
  if (config.provider === "ollama") return listOllamaModels(config.baseUrl, signal);
  return null;
}
