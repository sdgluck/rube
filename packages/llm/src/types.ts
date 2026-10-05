export type LlmProvider = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compatible";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmRequest {
  prompt: string;
  /**
   * Sent ahead of `prompt`, and marked cacheable where the provider supports
   * it. Put the part that repeats across a run's calls here — the library
   * list — and the part that varies in `prompt`. A prefix only caches while it
   * is byte-identical, so this must not contain anything per-call: a seed, a
   * timestamp, the one title the call is about.
   */
  cacheablePrefix?: string;
  /**
   * The budget for the *answer*. A reasoning model spends tokens thinking
   * before it answers, out of the same allowance, so providers add headroom on
   * top of this when the model reasons — a caller asking for a 200-token
   * summary should not have to know whether the model thinks first.
   */
  maxTokens?: number;
  temperature?: number;
  /**
   * A JSON Schema the answer must match, applied where the provider can
   * enforce it (Ollama's `format`). Elsewhere it is ignored and the prompt's
   * own format instructions carry the weight, so callers still parse
   * defensively.
   */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  /** Every prompt token, cached or not. */
  tokensIn: number;
  tokensOut: number;
  /** The part of `tokensIn` served from the provider's prompt cache, where it says. */
  tokensInCached?: number;
  model: string;
  provider: LlmProvider;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  /**
   * Proves the server answers, the key is accepted and the model exists,
   * without generating anything. The health check calls this every minute: a
   * generation there was a billed request per minute on a hosted provider and,
   * on Ollama, kept a multi-gigabyte model resident on the GPU forever.
   */
  ping(signal?: AbortSignal): Promise<LlmResponse>;
}

export type ProviderFieldRequirement = "required" | "optional" | "hidden";

export interface ProviderMeta {
  id: LlmProvider;
  label: string;
  fields: {
    apiKey: ProviderFieldRequirement;
    baseUrl: ProviderFieldRequirement;
  };
  modelPresets: { id: string; label: string }[];
  defaultModel: string;
  defaultBaseUrl?: string;
  signupUrl?: string;
  keyHint?: string;
  description?: string;
}

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

export class LlmRequestError extends Error {
  provider: LlmProvider;
  status: number | undefined;
  constructor(provider: LlmProvider, status: number | undefined, message: string) {
    super(message);
    this.name = "LlmRequestError";
    this.provider = provider;
    this.status = status;
  }
}
