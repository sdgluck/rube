import { createLlmClient } from "@tinkerbell/llm";
import { errorMessage } from "#lib/util.ts";
import { getLlmConfig } from "#lib/config.ts";
import { reportHealth } from "#domains/health.ts";

export interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Single chokepoint for the LLM call shared by run + preview. Owns
 * health reporting so we don't have to repeat the try/catch in every
 * caller. Routes through `@tinkerbell/llm` so the active provider is
 * whatever the user configured (Anthropic, OpenAI, Gemini, Ollama, …).
 */
export async function askLlm(prompt: string, itemList: string, signal?: AbortSignal): Promise<LlmCallResult> {
  const cfg = getLlmConfig();
  if (!cfg) {
    throw new Error("LLM provider is not configured. Set one in Settings → AI.");
  }

  const seed = Math.floor(Math.random() * 1_000_000);
  const fullPrompt = `${prompt}\n\nRandom seed for variety: ${seed}\n\nHere are the items:\n${itemList}`;

  signal?.throwIfAborted();

  const client = createLlmClient(cfg);
  try {
    const res = await client.complete({ prompt: fullPrompt, signal });
    reportHealth("LLM", "ok", `${res.provider}:${res.model} — ${res.tokensIn} in, ${res.tokensOut} out`);
    return { text: res.text, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
  } catch (err) {
    reportHealth("LLM", "error", errorMessage(err));
    throw err;
  }
}

/** Fisher-Yates shuffle, used to randomize the item list we send the LLM. */
export function shuffled<T>(input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
