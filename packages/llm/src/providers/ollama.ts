/**
 * Ollama, through its native `/api/chat` rather than the `/v1` OpenAI shim.
 *
 * The shim was the cause of every Ollama failure this integration had, because
 * the three settings a local model needs are not reachable through it:
 *
 * - **Context size.** `/v1` cannot set `num_ctx`, so a prompt runs in the
 *   server's default window — a few thousand tokens — and a longer one is
 *   truncated *silently*, with a 200. A because-you-watched prompt carries the
 *   whole library (~25k tokens for 4,000 films), so the model never saw the
 *   instructions at all. Here the window is sized to the prompt, and a prompt
 *   the model cannot hold fails before it is sent.
 * - **Reasoning.** gpt-oss, qwen3 and deepseek-r1 think before answering, out
 *   of the same `num_predict` budget. Through `/v1` a short budget came back
 *   as empty content. Here thinking is turned down (or off, where the model
 *   allows) and budgeted for.
 * - **Structured output.** `format` takes a JSON Schema and constrains
 *   decoding to it, which is the difference between a small local model that
 *   usually returns parseable JSON and one that always does.
 *
 * It also streams, so the deadline can be "stopped producing tokens" rather
 * than one wall-clock figure: loading a 20B model and reading a 25k-token
 * prompt on modest hardware legitimately takes minutes before the first token.
 */
import type { LlmClient, LlmConfig, LlmRequest, LlmResponse } from "../types.ts";
import { LlmConfigError, LlmRequestError } from "../types.ts";
import {
  DEFAULT_MAX_TOKENS,
  PING_TIMEOUT_MS,
  REASONING_HEADROOM_TOKENS,
  deadline,
  fullPrompt,
  pingResponse,
} from "./shared.ts";
import { modelNotFoundMessage } from "./openai.ts";

const DEFAULT_BASE_URL = "http://localhost:11434";

/** Until the first token: model load plus reading the whole prompt. */
const FIRST_TOKEN_TIMEOUT_MS = 10 * 60_000;
/** Between tokens once it has started. A model that goes quiet this long has stalled. */
const IDLE_TIMEOUT_MS = 2 * 60_000;
/** The backstop the lint asks for; idleness is what actually ends a stuck call. */
const HARD_TIMEOUT_MS = 30 * 60_000;

/**
 * The smallest window we ask for. Ollama reloads a model whenever `num_ctx`
 * changes, so every call sized to its own exact length would reload between
 * a summary and a rule. A floor plus power-of-two steps keeps it to a handful
 * of sizes that stay loaded.
 */
const MIN_CONTEXT = 8192;

/** A little for the chat template wrapped around the message. */
const CHAT_TEMPLATE_TOKENS = 64;

/**
 * Bytes, not characters, over three. Latin titles run about four characters
 * to a token, so this overestimates them by a third — which is the safe
 * direction, since underestimating is the silent truncation this file exists
 * to prevent. CJK titles are three bytes and roughly one token a character,
 * and this still holds for them where a character count would not.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
}

export function contextFor(needed: number, modelMax: number | undefined): number {
  let size = MIN_CONTEXT;
  while (size < needed) size *= 2;
  return modelMax ? Math.min(size, modelMax) : size;
}

interface ModelInfo {
  contextLength?: number;
  thinking: boolean;
}

/**
 * `/api/show` per base URL and model, briefly. A client is built per call, so
 * without this every request in a 20-call because-you-watched run would ask
 * first. Ten minutes is long enough to cover a run and short enough that
 * re-pulling a model is noticed the same evening.
 */
const SHOW_TTL_MS = 10 * 60_000;
const showCache = new Map<string, { at: number; info: ModelInfo }>();

/** `llama3.1` and `llama3.1:latest` are the same model to Ollama. */
function sameModel(a: string, b: string): boolean {
  const norm = (m: string) => (m.includes(":") ? m : `${m}:latest`);
  return norm(a) === norm(b);
}

export function ollamaBaseUrl(configured: string | undefined): string {
  // People paste the `/v1` URL from guides written for the OpenAI shim.
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Names of the models pulled on the server, for the Settings dropdown and the ping. */
export async function listOllamaModels(baseUrl: string | undefined, signal?: AbortSignal): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${ollamaBaseUrl(baseUrl)}/api/tags`, {
      headers: { Accept: "application/json" },
      signal: deadline(signal, PING_TIMEOUT_MS),
    });
  } catch (err) {
    throw new LlmRequestError("ollama", undefined, err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new LlmRequestError("ollama", res.status, `${res.status} ${res.statusText} from /api/tags`);
  }
  const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
  return (data.models ?? []).map((m) => m.name ?? m.model).filter((n): n is string => typeof n === "string");
}

export function createOllamaClient(config: LlmConfig): LlmClient {
  const baseUrl = ollamaBaseUrl(config.baseUrl);
  const model = config.model;
  if (!model) throw new LlmConfigError("Ollama provider requires a model.");
  // Ollama ignores it; an authenticating proxy in front of Ollama may not.
  const auth: Record<string, string> = { Authorization: `Bearer ${config.apiKey ?? "ollama"}` };

  async function modelInfo(signal?: AbortSignal): Promise<ModelInfo> {
    const key = `${baseUrl}\u0000${model}`;
    const hit = showCache.get(key);
    if (hit && Date.now() - hit.at < SHOW_TTL_MS) return hit.info;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...auth },
        body: JSON.stringify({ model }),
        signal: deadline(signal, PING_TIMEOUT_MS),
      });
    } catch (err) {
      throw new LlmRequestError("ollama", undefined, err instanceof Error ? err.message : String(err));
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new LlmRequestError(
        "ollama",
        404,
        `Model "${model}" is not pulled on this server — run \`ollama pull ${model}\``,
      );
    }
    if (!res.ok) {
      const body = await res.text();
      throw new LlmRequestError(
        "ollama",
        res.status,
        errorFrom(body) ?? `${res.status} ${res.statusText} from /api/show`,
      );
    }
    const data = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> };
    // The key is architecture-prefixed: `llama.context_length`, `gptoss.context_length`.
    const ctxEntry = Object.entries(data.model_info ?? {}).find(([k]) => k.endsWith(".context_length"));
    const info: ModelInfo = {
      contextLength: typeof ctxEntry?.[1] === "number" ? ctxEntry[1] : undefined,
      thinking: (data.capabilities ?? []).includes("thinking"),
    };
    showCache.set(key, { at: Date.now(), info });
    return info;
  }

  /** The answer's share of the window: its budget, plus room to think first. */
  function predictFor(info: ModelInfo, maxTokens: number | undefined): number {
    const answerBudget = maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
    return info.thinking ? answerBudget + REASONING_HEADROOM_TOKENS : answerBudget;
  }

  async function promptBudget(opts: { maxTokens?: number }, signal?: AbortSignal): Promise<number | undefined> {
    const info = await modelInfo(signal);
    if (!info.contextLength) return undefined;
    return info.contextLength - CHAT_TEMPLATE_TOKENS - predictFor(info, opts.maxTokens);
  }

  async function complete(req: LlmRequest): Promise<LlmResponse> {
    const info = await modelInfo(req.signal);
    // Prefix first: Ollama reuses the KV cache for a prompt that starts the
    // same way as the last one, so the library list is read once per run.
    const content = fullPrompt(req);
    const numPredict = predictFor(info, req.maxTokens);
    const needed = estimateTokens(content) + CHAT_TEMPLATE_TOKENS + numPredict;
    if (info.contextLength && needed > info.contextLength) {
      throw new LlmRequestError(
        "ollama",
        undefined,
        `This request needs about ${needed.toLocaleString("en-GB")} tokens of context but ${model} holds ` +
          `${info.contextLength.toLocaleString("en-GB")}. Use a model with a larger context window, or narrow the rule to fewer titles.`,
      );
    }
    const temperature = req.temperature ?? config.temperature;

    const body = {
      model,
      messages: [{ role: "user", content }],
      stream: true,
      // gpt-oss cannot stop thinking, only think less; the others can stop.
      ...(info.thinking ? { think: /gpt-oss/i.test(model) ? "low" : false } : {}),
      ...(req.jsonSchema ? { format: req.jsonSchema } : {}),
      options: {
        num_ctx: contextFor(needed, info.contextLength),
        num_predict: numPredict,
        ...(temperature !== undefined ? { temperature } : {}),
      },
    };

    const idle = new AbortController();
    let timer = setTimeout(
      () => idle.abort(new Error(`no response within ${FIRST_TOKEN_TIMEOUT_MS / 60_000} minutes`)),
      FIRST_TOKEN_TIMEOUT_MS,
    );
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => idle.abort(new Error(`stalled — nothing for ${IDLE_TIMEOUT_MS / 60_000} minutes`)),
        IDLE_TIMEOUT_MS,
      );
    };
    const deadlineOrIdle = AbortSignal.any([deadline(req.signal, HARD_TIMEOUT_MS), idle.signal]);

    let text = "";
    let thought = false;
    let final: OllamaChunk | undefined;
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...auth },
        body: JSON.stringify(body),
        signal: deadlineOrIdle,
      });
      if (!res.ok || !res.body) {
        const errBody = await res.text();
        throw new LlmRequestError("ollama", res.status, errorFrom(errBody) ?? `${res.status} ${res.statusText}`);
      }
      for await (const chunk of ndjson(res.body)) {
        bump();
        if (chunk.error) throw new LlmRequestError("ollama", res.status, chunk.error);
        text += chunk.message?.content ?? "";
        if (chunk.message?.thinking) thought = true;
        if (chunk.done) final = chunk;
      }
    } catch (err) {
      if (err instanceof LlmRequestError) throw err;
      const reason = idle.signal.aborted ? (idle.signal.reason as Error).message : undefined;
      throw new LlmRequestError("ollama", undefined, reason ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      clearTimeout(timer);
    }

    text = text.trim();
    if (!text) {
      const why =
        final?.done_reason === "length"
          ? thought
            ? ": the model spent its whole token budget reasoning and never answered"
            : ": the model hit its token limit before answering"
          : "";
      throw new LlmRequestError("ollama", undefined, `Response contained no message content${why}`);
    }
    return {
      text,
      tokensIn: final?.prompt_eval_count ?? 0,
      tokensOut: final?.eval_count ?? 0,
      model: final?.model ?? model,
      provider: "ollama",
    };
  }

  /** `/api/tags`: the server answers and the model is pulled. Loads nothing. */
  async function ping(signal?: AbortSignal): Promise<LlmResponse> {
    const names = await listOllamaModels(baseUrl, signal);
    if (!names.some((n) => sameModel(n, model))) {
      throw new LlmRequestError(
        "ollama",
        404,
        names.length === 0
          ? `No models are pulled on this server — run \`ollama pull ${model}\``
          : `${modelNotFoundMessage(model, names)} — run \`ollama pull ${model}\``,
      );
    }
    return pingResponse("ollama", model);
  }

  return { provider: "ollama", model, complete, ping, promptBudget };
}

interface OllamaChunk {
  model?: string;
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<OllamaChunk> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const bytes of body) {
    buffered += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line) yield JSON.parse(line) as OllamaChunk;
    }
  }
  if (buffered.trim()) yield JSON.parse(buffered) as OllamaChunk;
}

function errorFrom(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { error?: string }).error;
  } catch {
    return body || undefined;
  }
}
