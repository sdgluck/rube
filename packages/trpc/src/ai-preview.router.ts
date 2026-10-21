import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { errorMessage } from "@rube/core";
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
 * A test starts in the background and is polled, not answered on the request
 * that started it. It used to be one mutation held open for the whole run — a
 * library read plus up to three model calls, minutes on a big library — and a
 * reverse proxy in front of Rube (nginx gives up after 60s) answered the
 * browser with its own HTML 504 page while the server carried on spending
 * tokens on an answer nobody would see. Polling also lets the page say which
 * step it's on, which is the only clue when one is slow.
 *
 * Runs live in this router's memory: a test is a few minutes of one admin's
 * attention, not something to survive a restart.
 */
export function createAiPreviewRouter(deps: Pick<TrpcDeps, "jobs">) {
  const { previewBecauseYouWatched } = deps.jobs;

  /** A local model loading and reading a whole library three times over is minutes, not seconds. */
  const PREVIEW_TIMEOUT_MS = 15 * 60_000;
  /** The page polls every second or so; this long without one means the tab is gone, so stop paying for the answer. */
  const ABANDONED_AFTER_MS = 60_000;
  /** Finished runs kept for a late poll — a phone that slept through the end. */
  const KEEP_FINISHED = 5;

  type Result = Awaited<ReturnType<typeof previewBecauseYouWatched>>;
  type Input = Parameters<typeof previewBecauseYouWatched>[0];
  interface Run {
    id: string;
    /** What was asked for, so a reloaded page can show the form as it was when the test started. */
    input: Input;
    startedAt: number;
    finishedAt: number | null;
    state: "running" | "done" | "failed" | "cancelled";
    steps: Array<{ atMs: number; message: string }>;
    result: Result | null;
    error: string | null;
    lastPolledAt: number;
    controller: AbortController;
  }
  const runs = new Map<string, Run>();

  function prune() {
    const finished = [...runs.values()].filter((r) => r.state !== "running");
    for (const r of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) runs.delete(r.id);
  }

  function snapshot(run: Run) {
    const { controller: _controller, lastPolledAt: _lastPolledAt, ...rest } = run;
    return { ...rest, elapsedMs: (run.finishedAt ?? Date.now()) - run.startedAt };
  }

  return t.router({
    becauseYouWatched: t.router({
      start: procedure
        .input(
          z.object({
            sectionKey: z.string().min(1),
            /** Whose history and preferences to use; omitted, the server-wide history. */
            plexUsername: z.string().min(1).optional(),
            /** A specific title instead of the most recent ones. */
            watchedTitle: z.string().min(1).max(300).optional(),
            /** Recent titles to try. More than one shows prompt caching at work. */
            count: z.number().int().min(1).max(3).default(1),
            /** Send the watched title's synopsis; omitted, whatever the job is set to. */
            includeSynopsis: z.boolean().optional(),
          }),
        )
        .mutation(({ input }) => {
          // One at a time: a double click, or a second tab, would otherwise
          // pay for the same answer twice.
          if ([...runs.values()].some((r) => r.state === "running")) {
            throw new TRPCError({ code: "CONFLICT", message: "A test is already running — wait for it or stop it." });
          }
          prune();

          const now = Date.now();
          const run: Run = {
            id: randomUUID(),
            input,
            startedAt: now,
            finishedAt: null,
            state: "running",
            steps: [],
            result: null,
            error: null,
            lastPolledAt: now,
            controller: new AbortController(),
          };
          runs.set(run.id, run);

          const abandoned = setInterval(() => {
            if (Date.now() - run.lastPolledAt > ABANDONED_AFTER_MS) {
              run.controller.abort(new Error("Stopped — the page that started this test stopped asking for it."));
            }
          }, 10_000).unref();
          const signal = AbortSignal.any([run.controller.signal, AbortSignal.timeout(PREVIEW_TIMEOUT_MS)]);
          const step = (message: string) => run.steps.push({ atMs: Date.now() - run.startedAt, message });

          step("Started.");
          previewBecauseYouWatched(input, signal, step)
            .then((result) => {
              run.result = result;
              run.state = "done";
              step("Done.");
            })
            .catch((err: unknown) => {
              const cancelled = run.controller.signal.aborted;
              run.state = cancelled ? "cancelled" : "failed";
              run.error = cancelled ? errorMessage(run.controller.signal.reason) : errorMessage(err);
              step(run.error);
            })
            .finally(() => {
              run.finishedAt = Date.now();
              clearInterval(abandoned);
            });

          return { id: run.id };
        }),

      status: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
        const run = runs.get(input.id);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "That test is no longer held — run it again." });
        run.lastPolledAt = Date.now();
        return snapshot(run);
      }),

      /**
       * The test still running, if any. A reload — or a second tab — picks it
       * back up rather than showing an idle form while the server carries on
       * paying for an answer, and then refusing a new test as "already running".
       */
      active: procedure.query(() => {
        const run = [...runs.values()].find((r) => r.state === "running");
        if (!run) return null;
        run.lastPolledAt = Date.now();
        return snapshot(run);
      }),

      cancel: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
        const run = runs.get(input.id);
        if (run?.state === "running") run.controller.abort(new Error("Stopped."));
        return { ok: true };
      }),
    }),
  });
}
