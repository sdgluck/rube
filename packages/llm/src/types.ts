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
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: LlmProvider;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
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
