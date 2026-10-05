import type { LlmProvider, LlmRequest, LlmResponse } from "../types.ts";

/**
 * Hard deadline on a completion.
 *
 * Generous, because a large local model on modest hardware is genuinely slow —
 * but not absent. `req.signal` alone is the caller's abort, and nothing fires
 * it on its own; a socket that hangs here hangs the whole job queue behind it.
 */
export const REQUEST_TIMEOUT_MS = 5 * 60_000;

/**
 * Deadline on a ping. It asks a listing endpoint, not the model, so anything
 * past this is a server that isn't answering. The health check runs every
 * minute and checks services one after another; a slow ping delays the rest.
 */
export const PING_TIMEOUT_MS = 15_000;

/**
 * Tokens added to `maxTokens` when the model reasons before answering.
 *
 * Without it a reasoning model handed the summary's 200-token budget spends
 * all 200 thinking and returns nothing — the empty-content failure that a
 * gpt-oss "Test connection" first showed. Every call in this app is a short,
 * structured selection, and providers that can are asked to reason lightly,
 * so this is room to finish, not an invitation to think for longer.
 */
export const REASONING_HEADROOM_TOKENS = 4096;

export const DEFAULT_MAX_TOKENS = 4096;

export function deadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/** The whole prompt for a provider with no separate cacheable block. */
export function fullPrompt(req: LlmRequest): string {
  return req.cacheablePrefix ? `${req.cacheablePrefix}\n\n${req.prompt}` : req.prompt;
}

/** What a ping returns: no text and no tokens, because nothing was generated. */
export function pingResponse(provider: LlmProvider, model: string): LlmResponse {
  return { text: "", tokensIn: 0, tokensOut: 0, model, provider };
}
