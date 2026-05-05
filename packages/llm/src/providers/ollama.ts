import type { LlmClient, LlmConfig } from "../types.ts";
import { createOpenAiCompatibleClient } from "./openai.ts";

export function createOllamaClient(config: LlmConfig): LlmClient {
  const base = (config.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
  // Ollama exposes an OpenAI-compatible API at /v1
  const baseUrl = base.endsWith("/v1") ? base : `${base}/v1`;
  return createOpenAiCompatibleClient(
    { ...config, baseUrl, apiKey: config.apiKey ?? "ollama" },
    { provider: "ollama", defaultBaseUrl: "http://localhost:11434/v1", apiKeyRequired: false },
  );
}
