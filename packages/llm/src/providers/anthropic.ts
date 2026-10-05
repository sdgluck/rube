import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmConfig, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";
import { DEFAULT_MAX_TOKENS, PING_TIMEOUT_MS, REASONING_HEADROOM_TOKENS, pingResponse } from "./shared.ts";

/**
 * The Claude 5 family thinks on every request and rejects sampling
 * parameters; the 4.x models this integration was written against do neither.
 * Sending `temperature` to one of these is a 400, and sending the 4.x-sized
 * `max_tokens` lets thinking eat the whole answer.
 */
export function anthropicModelReasons(model: string): boolean {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model);
}

export function createAnthropicClient(config: LlmConfig): LlmClient {
  if (!config.apiKey) throw new LlmConfigError("Anthropic provider requires an API key.");
  // `baseUrl` is hidden in Settings for Anthropic; it is honoured so the tests
  // can drive the real SDK against a local server.
  const sdk = new Anthropic({ apiKey: config.apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) });
  const model = config.model;
  const reasons = anthropicModelReasons(model);

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    const answerBudget = req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = req.temperature ?? config.temperature;

    // The prefix is its own block with a cache breakpoint on it. A nightly
    // because-you-watched run sends the same ~25k-token library list once per
    // recently watched title; cached, every call after the first reads it at
    // a tenth of the input price instead of paying for it again.
    const content: Anthropic.ContentBlockParam[] = req.cacheablePrefix
      ? [
          { type: "text", text: req.cacheablePrefix, cache_control: { type: "ephemeral" } },
          { type: "text", text: req.prompt },
        ]
      : [{ type: "text", text: req.prompt }];

    let response: Anthropic.Message;
    try {
      response = await sdk.messages.create(
        {
          model,
          max_tokens: reasons ? answerBudget + REASONING_HEADROOM_TOKENS : answerBudget,
          ...(reasons
            ? // Every call here is a short, structured pick from a list. Low
              // effort keeps the thinking (billed as output) proportionate.
              { output_config: { effort: "low" as const } }
            : temperature !== undefined
              ? { temperature }
              : {}),
          messages: [{ role: "user", content }],
        },
        { signal: req.signal },
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      throw new LlmRequestError("anthropic", status, err instanceof Error ? err.message : String(err));
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) {
      const why =
        response.stop_reason === "max_tokens"
          ? ": the model hit its token limit before answering"
          : response.stop_reason === "refusal"
            ? ": the model declined the request"
            : "";
      throw new LlmRequestError("anthropic", undefined, `Anthropic response contained no text${why}`);
    }
    const usage = response.usage;
    const cached = usage.cache_read_input_tokens ?? 0;
    return {
      text,
      // `input_tokens` is only the uncached remainder; the budget and the usage
      // page count what was sent.
      tokensIn: usage.input_tokens + cached + (usage.cache_creation_input_tokens ?? 0),
      tokensOut: usage.output_tokens,
      tokensInCached: cached,
      model: response.model,
      provider: "anthropic",
    };
  }

  async function ping(signal?: AbortSignal): Promise<LlmResponse> {
    try {
      // Checks the key and the model name together, and costs nothing.
      await sdk.models.retrieve(model, {}, { signal, timeout: PING_TIMEOUT_MS, maxRetries: 0 });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message =
        status === 404 ? `Model "${model}" was not found` : err instanceof Error ? err.message : String(err);
      throw new LlmRequestError("anthropic", status, message);
    }
    return pingResponse("anthropic", model);
  }

  return { provider: "anthropic", model, complete, ping };
}
