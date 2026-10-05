import type { LlmProvider, ProviderMeta } from "./types.ts";

export type { LlmProvider, ProviderMeta, ProviderFieldRequirement, LlmConfig } from "./types.ts";

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    fields: { apiKey: "required", baseUrl: "hidden" },
    defaultModel: "claude-opus-5-5",
    modelPresets: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    ],
    signupUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    description: "Anthropic Claude API.",
  },
  {
    id: "openai",
    label: "OpenAI",
    fields: { apiKey: "required", baseUrl: "hidden" },
    defaultModel: "gpt-4o",
    modelPresets: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-5", label: "GPT-5" },
    ],
    signupUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    description: "OpenAI API.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    fields: { apiKey: "required", baseUrl: "hidden" },
    defaultModel: "gemini-2.5-pro",
    modelPresets: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    ],
    signupUrl: "https://aistudio.google.com/apikey",
    description: "Google AI Studio / Gemini API.",
  },
  {
    id: "ollama",
    label: "Ollama (self-hosted)",
    fields: { apiKey: "hidden", baseUrl: "required" },
    defaultModel: "gemma3:12b",
    defaultBaseUrl: "http://localhost:11434",
    // Fallback only: Settings lists the models actually pulled on the server
    // (`listModels`). Picked for this workload — a 25k-token library list in
    // context, titles copied back exactly, no long reasoning step.
    modelPresets: [
      { id: "gemma3:27b", label: "Gemma 3 27B (24GB+)" },
      { id: "qwen3:30b-a3b", label: "Qwen 3 30B-A3B (24GB+)" },
      { id: "gemma3:12b", label: "Gemma 3 12B (~16GB)" },
      { id: "qwen3:14b", label: "Qwen 3 14B (~16GB)" },
      { id: "qwen3:8b", label: "Qwen 3 8B" },
      { id: "gpt-oss:20b", label: "gpt-oss 20B (always reasons)" },
    ],
    description: "Ollama running locally or on your network.",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    fields: { apiKey: "optional", baseUrl: "required" },
    defaultModel: "",
    modelPresets: [],
    description:
      "Any provider exposing the OpenAI chat-completions API: OpenRouter, Groq, Together, DeepSeek, xAI, Mistral, Fireworks, vLLM, LM Studio, llama.cpp server, etc.",
  },
];

export function getProviderMeta(id: LlmProvider): ProviderMeta {
  const meta = PROVIDERS.find((p) => p.id === id);
  if (!meta) throw new Error(`Unknown LLM provider: ${id}`);
  return meta;
}
