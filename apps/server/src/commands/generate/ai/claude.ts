import Anthropic from "@anthropic-ai/sdk";
import { errorMessage, extractClaudeText } from "../../../lib/util.ts";
import { getConfig } from "../../../lib/config.ts";
import { reportHealth } from "../../../domains/health.ts";

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const TEMPERATURE = 1;

export interface ClaudeResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Single chokepoint for the Anthropic call shared by run + preview. Owns
 * health reporting so we don't have to repeat the try/catch in every
 * caller.
 */
export async function askClaude(prompt: string, itemList: string, signal?: AbortSignal): Promise<ClaudeResult> {
  const apiKey = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key is required for AI prompt rules. Configure it in Settings.");
  }

  const seed = Math.floor(Math.random() * 1_000_000);
  const anthropic = new Anthropic({ apiKey });

  signal?.throwIfAborted();
  let response;
  try {
    response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nRandom seed for variety: ${seed}\n\nHere are the items:\n${itemList}`,
          },
        ],
      },
      { signal },
    );
    reportHealth(
      "Claude AI",
      "ok",
      `${response.model} — ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`,
    );
  } catch (err) {
    reportHealth("Claude AI", "error", errorMessage(err));
    throw err;
  }

  return {
    text: extractClaudeText(response),
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  };
}

/** Fisher-Yates shuffle, used to randomize the item list we send Claude. */
export function shuffled<T>(input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
