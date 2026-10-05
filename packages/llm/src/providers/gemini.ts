import type { LlmClient, LlmConfig, LlmRequest, LlmResponse } from "../types.ts";
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

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

/**
 * 2.5 and later think by default, and the thinking is drawn from
 * `maxOutputTokens` — a tight budget comes back as a candidate with no parts
 * and `finishReason: "MAX_TOKENS"`.
 */
function geminiModelReasons(model: string): boolean {
  return /^gemini-(2\.5|[3-9])/.test(model);
}

export function createGeminiClient(config: LlmConfig): LlmClient {
  if (!config.apiKey) throw new LlmConfigError("Gemini provider requires an API key.");
  const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const model = config.model;
  if (!model) throw new LlmConfigError("Gemini provider requires a model.");
  const reasons = geminiModelReasons(model);
  const modelUrl = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}`;
  const key = `key=${encodeURIComponent(config.apiKey)}`;

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    const answerBudget = req.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = req.temperature ?? config.temperature;

    let res: Response;
    try {
      res = await fetch(`${modelUrl}:generateContent?${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          // Gemini caches a repeated prefix implicitly; the stable part goes first.
          contents: [{ role: "user", parts: [{ text: fullPrompt(req) }] }],
          generationConfig: {
            maxOutputTokens: reasons ? answerBudget + REASONING_HEADROOM_TOKENS : answerBudget,
            ...(temperature !== undefined ? { temperature } : {}),
          },
        }),
        signal: deadline(req.signal, REQUEST_TIMEOUT_MS),
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

    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const why = candidate?.finishReason === "MAX_TOKENS" ? ": the model hit its token limit before answering" : "";
      throw new LlmRequestError("gemini", res.status, `Response contained no text parts${why}`);
    }
    const cached = data?.usageMetadata?.cachedContentTokenCount;
    return {
      text,
      tokensIn: data?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data?.usageMetadata?.candidatesTokenCount ?? 0,
      ...(cached !== undefined ? { tokensInCached: cached } : {}),
      model: data?.modelVersion ?? model,
      provider: "gemini",
    };
  }

  /** `GET models/{model}`: checks the key and the model name, generates nothing. */
  async function ping(signal?: AbortSignal): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await fetch(`${modelUrl}?${key}`, {
        headers: { Accept: "application/json" },
        signal: deadline(signal, PING_TIMEOUT_MS),
      });
    } catch (err) {
      throw new LlmRequestError("gemini", undefined, err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) {
      const bodyText = await res.text();
      let message = `${res.status} ${res.statusText}`;
      try {
        message = (JSON.parse(bodyText) as GeminiResponse).error?.message ?? message;
      } catch {
        // keep the status line
      }
      throw new LlmRequestError("gemini", res.status, res.status === 404 ? `Model "${model}" was not found` : message);
    }
    await res.body?.cancel();
    return pingResponse("gemini", model);
  }

  return { provider: "gemini", model, complete, ping };
}
