import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { errorMessage } from "@tinkerbell/core";
import type { TrpcDeps } from "./deps.ts";

import { t, procedure } from "./_base.ts";

/**
 * "Try it" for the AI features, from Settings → AI.
 *
 * The question these answer is "what would tonight's run do, and what would it
 * cost?" — before the run, not in the morning. Each one goes through the same
 * code as the job it previews, writes nothing to Plex, and returns the call's
 * own usage, so a provider or model change can be judged on one result
 * instead of a night's bill.
 *
 * Mutations, not queries: each one spends tokens, and a query would re-run on
 * window focus or a cache invalidation.
 */
export function createAiPreviewRouter(deps: Pick<TrpcDeps, "jobs">) {
  const { previewBecauseYouWatched } = deps.jobs;

  /** A local model loading and reading a whole library three times over is minutes, not seconds. */
  const PREVIEW_TIMEOUT_MS = 15 * 60_000;

  return t.router({
    becauseYouWatched: procedure
      .input(
        z.object({
          sectionKey: z.string().min(1),
          /** Whose history and preferences to use; omitted, the server-wide history. */
          plexUsername: z.string().min(1).optional(),
          /** A specific title instead of the most recent ones. */
          watchedTitle: z.string().min(1).max(300).optional(),
          /** Recent titles to try. More than one shows prompt caching at work. */
          count: z.number().int().min(1).max(3).default(1),
        }),
      )
      .mutation(async ({ input, signal }) => {
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(PREVIEW_TIMEOUT_MS)])
          : AbortSignal.timeout(PREVIEW_TIMEOUT_MS);
        try {
          return await previewBecauseYouWatched(input, deadline);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: errorMessage(err) });
        }
      }),
  });
}
