import { trimTrailing } from "@rube/http";
import type { LlmClient, LlmConfig, LlmProvider, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";
import {
  DEFAULT_MAX_TOKENS,
  PING_TIMEOUT_MS,
  REASONING_HEADROOM_TOKENS,
  REQUEST_TIMEOUT_MS,
  deadline,
  fullPrompt,
  pingResponse,
} from "./shared.ts";

type Choice = {
  message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null };
  finish_reason?: string | null;
};

interface OpenAiCompletionResponse {
  model?: string;
  choices?: Choice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

interface Options {
  provider: LlmProvider;
  defaultBaseUrl: string;
  apiKeyRequired: boolean;
}

/**
 * OpenAI's own reasoning models. They reject `max_tokens` in favour of
 * `max_completion_tokens`, which covers the reasoning as well as the answer.
 * Only checked for the `openai` provider: an OpenAI-compatible server names
 * its models however it likes, and most of them only know `max_tokens`.
 */
function openAiModelReasons(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

export function createOpenAiCompatibleClient(config: LlmConfig, options: Options): LlmClient {
  if (options.apiKeyRequired && !config.apiKey) {
    throw new LlmConfigError(`${options.provider} provider requires an API key.`);
  }
  const baseUrl = trimTrailing(config.baseUrl ?? options.defaultBaseUrl);
  if (!baseUrl) throw new LlmConfigError(`${options.provider} provider requires a base URL.`);
  const model = config.model;
  if (!model) throw new LlmConfigError(`${options.provider} provider requires a model.`);
  const reasons = options.provider === "openai" && openAiModelReasons(model);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  async function request(req: LlmRequest, mode: "complete" | "ping"): Promise<LlmResponse> {
    const answerBudget = req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = req.temperature ?? config.temperature;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: deadline(req.signal, REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          ...(reasons
            ? { max_completion_tokens: answerBudget + REASONING_HEADROOM_TOKENS, reasoning_effort: "low" }
            : { max_tokens: answerBudget }),
          // Only when someone set it. OpenAI's reasoning models reject any
          // value but the default, so sending the default was never needed
          // and anything else is a 400.
          ...(temperature !== undefined && !reasons ? { temperature } : {}),
          // OpenAI caches a matching prompt prefix on its own; putting the
          // stable part first is all it needs.
          messages: [{ role: "user", content: fullPrompt(req) }],
        }),
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

    // Trim *before* the emptiness check, not after.
    //
    // The check used to be `text.length === 0`, which a whitespace-only
    // response passes — and it was then trimmed to `""` on the way out. An
    // empty string is not an error anywhere downstream: the prompt parser finds
    // no collections in it, the rule builds none, and the run goes green. A
    // model that answers with a blank line has to fail here or not at all.
    // `gemini.ts` already checked the trimmed value; these now agree.
    const choice = data?.choices?.[0];
    const raw = choice?.message?.content;
    const text = typeof raw === "string" ? raw.trim() : undefined;
    if (!text) {
      // The fallback ping asks for one token, and a reasoning model spends it
      // thinking: `content` is "" and the token is in `reasoning`. The server,
      // key and model all answered, which is everything a ping is for. A
      // completion with no choice at all is still a malformed answer.
      if (mode === "ping" && choice) return pingResponse(options.provider, data?.model ?? model);
      throw new LlmRequestError(options.provider, res.status, emptyContentMessage(choice));
    }
    const cached = data?.usage?.prompt_tokens_details?.cached_tokens;
    return {
      text,
      tokensIn: data?.usage?.prompt_tokens ?? 0,
      tokensOut: data?.usage?.completion_tokens ?? 0,
      ...(cached !== undefined ? { tokensInCached: cached } : {}),
      model: data?.model ?? model,
      provider: options.provider,
    };
  }

  /**
   * `GET /models`, which every server this provider is used with implements —
   * OpenAI, OpenRouter, vLLM, LM Studio, llama.cpp — and which generates
   * nothing. A server that doesn't have it falls back to a one-token request.
   */
  async function ping(signal?: AbortSignal): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/models`, { headers, signal: deadline(signal, PING_TIMEOUT_MS) });
    } catch (err) {
      throw new LlmRequestError(options.provider, undefined, err instanceof Error ? err.message : String(err));
    }
    if (res.status === 404 || res.status === 405) {
      await res.body?.cancel();
      return request({ prompt: "hi", maxTokens: 1, signal }, "ping");
    }
    const bodyText = await res.text();
    let data: { data?: Array<{ id?: string }>; error?: { message?: string } } | undefined;
    try {
      data = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      // fall through
    }
    if (!res.ok) {
      throw new LlmRequestError(
        options.provider,
        res.status,
        data?.error?.message ?? `${res.status} ${res.statusText}`,
      );
    }
    const ids = (data?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    // An empty or unparseable list proves the server and key but says nothing
    // about the model; don't fail a server that simply doesn't enumerate.
    if (ids.length > 0 && !ids.includes(model)) {
      throw new LlmRequestError(options.provider, 404, modelNotFoundMessage(model, ids));
    }
    return pingResponse(options.provider, model);
  }

  return {
    provider: options.provider,
    model,
    complete: (req: LlmRequest) => request(req, "complete"),
    ping,
  };
}

export function modelNotFoundMessage(model: string, available: string[]): string {
  const shown = available.slice(0, 8).join(", ");
  const more = available.length > 8 ? `, and ${available.length - 8} more` : "";
  return `Model "${model}" was not found on the server (available: ${shown}${more})`;
}

/**
 * Says *why* there was no content when the response says so.
 *
 * "No message content" alone reads as a broken server. The common real cause
 * is a reasoning model that hit `max_tokens` before it finished thinking —
 * the server is fine, the model is the wrong shape for a tight budget.
 */
function emptyContentMessage(choice: Choice | undefined): string {
  const base = "Response contained no message content";
  if (!choice) return base;
  const reasoned = Boolean(choice.message?.reasoning || choice.message?.reasoning_content);
  if (choice.finish_reason === "length") {
    return reasoned
      ? `${base}: the model spent its whole token budget reasoning and never answered`
      : `${base}: the model hit its token limit before answering`;
  }
  return base;
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
