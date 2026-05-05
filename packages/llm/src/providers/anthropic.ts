import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmConfig, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 1;

export function createAnthropicClient(config: LlmConfig): LlmClient {
  if (!config.apiKey) throw new LlmConfigError("Anthropic provider requires an API key.");
  const sdk = new Anthropic({ apiKey: config.apiKey });
  const model = config.model;

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    let response;
    try {
      response = await sdk.messages.create(
        {
          model,
          max_tokens: req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: req.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE,
          messages: [{ role: "user", content: req.prompt }],
        },
        { signal: req.signal },
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      throw new LlmRequestError("anthropic", status, err instanceof Error ? err.message : String(err));
    }

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text" || typeof block.text !== "string") {
      throw new LlmRequestError("anthropic", undefined, "Anthropic response contained no text block");
    }
    return {
      text: block.text.trim(),
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      model: response.model,
      provider: "anthropic",
    };
  }

  return {
    provider: "anthropic",
    model,
    complete,
    ping: (signal?: AbortSignal) => complete({ prompt: "hi", maxTokens: 1, signal }),
  };
}
