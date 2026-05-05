import type { LlmClient, LlmConfig, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 1;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

export function createGeminiClient(config: LlmConfig): LlmClient {
  if (!config.apiKey) throw new LlmConfigError("Gemini provider requires an API key.");
  const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const model = config.model;
  if (!model) throw new LlmConfigError("Gemini provider requires a model.");

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey!)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: {
            maxOutputTokens: req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: req.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE,
          },
        }),
        signal: req.signal,
      });
    } catch (err) {
      throw new LlmRequestError("gemini", undefined, err instanceof Error ? err.message : String(err));
    }

    const bodyText = await res.text();
    let data: GeminiResponse | undefined;
    try {
      data = bodyText ? (JSON.parse(bodyText) as GeminiResponse) : undefined;
    } catch {
      // fall through
    }

    if (!res.ok) {
      const message = data?.error?.message ?? bodyText ?? `${res.status} ${res.statusText}`;
      throw new LlmRequestError("gemini", res.status, message);
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new LlmRequestError("gemini", res.status, "Response contained no text parts");
    }
    return {
      text,
      tokensIn: data?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data?.usageMetadata?.candidatesTokenCount ?? 0,
      model: data?.modelVersion ?? model,
      provider: "gemini",
    };
  }

  return {
    provider: "gemini",
    model,
    complete,
    ping: (signal?: AbortSignal) => complete({ prompt: "hi", maxTokens: 1, signal }),
  };
}
