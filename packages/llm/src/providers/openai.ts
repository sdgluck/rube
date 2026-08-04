import type { LlmClient, LlmConfig, LlmProvider, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 1;

/**
 * Hard deadline on a completion.
 *
 * Generous, because a large local model on modest hardware is genuinely slow —
 * but not absent. `req.signal` alone is the caller's abort, and nothing fires
 * it on its own; a socket that hangs here hangs the whole job queue behind it.
 */
const REQUEST_TIMEOUT_MS = 5 * 60_000;

interface OpenAiCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface Options {
  provider: LlmProvider;
  defaultBaseUrl: string;
  apiKeyRequired: boolean;
}

export function createOpenAiCompatibleClient(config: LlmConfig, options: Options): LlmClient {
  if (options.apiKeyRequired && !config.apiKey) {
    throw new LlmConfigError(`${options.provider} provider requires an API key.`);
  }
  const baseUrl = (config.baseUrl ?? options.defaultBaseUrl).replace(/\/+$/, "");
  if (!baseUrl) throw new LlmConfigError(`${options.provider} provider requires a base URL.`);
  const model = config.model;
  if (!model) throw new LlmConfigError(`${options.provider} provider requires a model.`);

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: req.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE,
          messages: [{ role: "user", content: req.prompt }],
        }),
        signal: req.signal
          ? AbortSignal.any([req.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new LlmRequestError(options.provider, undefined, err instanceof Error ? err.message : String(err));
    }

    const bodyText = await res.text();
    let data: OpenAiCompletionResponse | undefined;
    try {
      data = bodyText ? (JSON.parse(bodyText) as OpenAiCompletionResponse) : undefined;
    } catch {
      // fall through — non-JSON error body
    }

    if (!res.ok) {
      const message = data?.error?.message ?? bodyText ?? `${res.status} ${res.statusText}`;
      throw new LlmRequestError(options.provider, res.status, message);
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new LlmRequestError(options.provider, res.status, "Response contained no message content");
    }
    return {
      text: text.trim(),
      tokensIn: data?.usage?.prompt_tokens ?? 0,
      tokensOut: data?.usage?.completion_tokens ?? 0,
      model: data?.model ?? model,
      provider: options.provider,
    };
  }

  return {
    provider: options.provider,
    model,
    complete,
    ping: (signal?: AbortSignal) => complete({ prompt: "hi", maxTokens: 1, signal }),
  };
}

export function createOpenAiClient(config: LlmConfig): LlmClient {
  return createOpenAiCompatibleClient(config, {
    provider: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyRequired: true,
  });
}

export function createGenericOpenAiCompatibleClient(config: LlmConfig): LlmClient {
  return createOpenAiCompatibleClient(config, {
    provider: "openai-compatible",
    defaultBaseUrl: "",
    apiKeyRequired: false,
  });
}
