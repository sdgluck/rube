import { useEffect, useRef, useState } from "react";
import { trpcClient } from "#/trpc";

/** Matches the run-metadata poll, so the log doesn't lag behind the progress bar. */
const LOG_POLL_MS = 1000;

/**
 * Where a slice of log comes from. Job runs and rule runs store their logs the
 * same way and slice them with the same offset arithmetic, so they share the
 * hook and differ only in which procedure answers.
 */
export type RunLogFetcher = (
  runId: string,
  offset: number,
) => Promise<{ chunk: string; nextOffset: number; size: number }>;

export const fetchJobRunLog: RunLogFetcher = (runId, offset) => trpcClient.jobs.runLog.query({ runId, offset });

export const fetchRuleRunLog: RunLogFetcher = (runId, offset) => trpcClient.rules.runLog.query({ runId, offset });

export const fetchStressTestRunLog: RunLogFetcher = (runId, offset) =>
  trpcClient.stressTest.runLog.query({ runId, offset });

/**
 * Accumulate a run's log by fetching only what's been appended since the last
 * poll.
 *
 * The whole log used to ride along with every `jobs.run` poll — once a second,
 * for as long as the run was live. A job that logs a few megabytes turned that
 * into megabytes-per-second of tRPC traffic for a pane the user may not even
 * be looking at.
 *
 * Uses the vanilla client rather than `useQuery` on purpose: the offset changes
 * on every request, so each poll would otherwise mint a new react-query cache
 * entry and the cache would grow with the log.
 */
export function useRunLog(
  runId: string | null | undefined,
  isActive: boolean,
  fetchSlice: RunLogFetcher = fetchJobRunLog,
): string {
  const [text, setText] = useState("");
  const offsetRef = useRef(0);

  // Reset on run change, before the effect below fetches anything, so a
  // previous run's output can never be prepended to a new one's.
  const lastRunId = useRef(runId);
  if (lastRunId.current !== runId) {
    lastRunId.current = runId;
    offsetRef.current = 0;
    if (text !== "") setText("");
  }

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    // The offset only advances once a response lands, so two polls in flight at
    // once would both request the same byte range and both append it. A tick is
    // dropped rather than queued: the next one is a second away and picks up
    // whatever accumulated meanwhile.
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetchSlice(runId, offsetRef.current);
        if (cancelled) return;
        if (res.size < offsetRef.current) {
          // The stored log shrank — a rewrite, not an append. Take it whole.
          const full = await fetchSlice(runId, 0);
          if (cancelled) return;
          setText(full.chunk);
          offsetRef.current = full.nextOffset;
          return;
        }
        if (res.chunk.length > 0) {
          setText((prev) => prev + res.chunk);
          offsetRef.current = res.nextOffset;
        }
      } catch {
        // A failed poll just means this tick shows stale text; the next one
        // picks up from the same offset.
      } finally {
        inFlight = false;
      }
    };

    void poll();
    if (!isActive) return () => void (cancelled = true);

    const timer = setInterval(() => void poll(), LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, isActive, fetchSlice]);

  return text;
}

/**
 * Statuses where a run is still producing output.
 *
 * Covers both vocabularies: a rule run adds `queued`, which is active but not
 * yet logging — callers that poll for output want it treated as live so the
 * pane is already watching when the run starts.
 */
export function isRunActive(status: string | undefined): boolean {
  return status === "running" || status === "cancelling" || status === "queued";
}
