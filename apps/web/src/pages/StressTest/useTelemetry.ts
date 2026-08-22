import { useEffect, useRef, useState } from "react";
import { trpcClient } from "#/trpc";
import type { StressActiveRun, StressSample } from "./types.ts";

/** Matches the log poll, so the charts and the log advance together. */
const LIVE_POLL_MS = 1000;

/**
 * The live run's state and its telemetry, accumulated across polls.
 *
 * The series is fetched incrementally — each poll asks only for samples after
 * the last `t` we hold — for the reason `useRunLog` exists: a stress run carries
 * up to a thousand samples with their per-session readings attached, and
 * re-serialising all of it once a second would make watching a run more
 * expensive than running it. On the one process deliberately trying to saturate
 * the machine, that is not a rounding error.
 *
 * Vanilla client rather than `useQuery`, for the same reason `useRunLog` uses
 * one: the offset moves on every poll, so each request would otherwise mint a
 * new react-query cache entry and the cache would grow with the run.
 */
export function useTelemetry(pollWhenIdleMs = 2000): {
  run: StressActiveRun | null;
  samples: StressSample[];
  isRunning: boolean;
} {
  const [run, setRun] = useState<StressActiveRun | null>(null);
  const [samples, setSamples] = useState<StressSample[]>([]);
  const sinceRef = useRef(-1);
  const heldRef = useRef(0);
  const runIdRef = useRef<string | null>(null);
  // Polls faster once something is running. The cadence has to be state rather
  // than a ref so the effect re-runs and re-arms the timer when it changes.
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The offset only advances once a response lands, so two polls in flight
    // would both ask for the same span and both append it.
    let inFlight = false;

    const reset = () => {
      sinceRef.current = -1;
      heldRef.current = 0;
      setSamples([]);
    };

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await trpcClient.stressTest.activeRun.query({ sinceT: sinceRef.current });
        if (cancelled) return;

        if (!next) {
          // No run in flight. The accumulated series is dropped rather than
          // left on screen — the finished row carries its own complete copy and
          // the page reads that instead.
          if (runIdRef.current !== null) {
            runIdRef.current = null;
            reset();
          }
          setRun(null);
          setLive(false);
          return;
        }

        setRun(next);
        setLive(true);

        if (runIdRef.current !== next.id) {
          runIdRef.current = next.id;
          reset();
          return;
        }

        // The worker thins the series once it outgrows its cap, which drops
        // points we already hold. Splicing fine-grained history onto a
        // coarsened tail would draw one chart at two time resolutions with
        // nothing to mark where they meet, so we start again from the top.
        if (next.total < heldRef.current) {
          reset();
          return;
        }

        if (next.samples.length === 0) return;
        heldRef.current += next.samples.length;
        sinceRef.current = next.nextSinceT;
        setSamples((prev) => [...prev, ...next.samples]);
      } catch {
        // A failed poll shows stale data for a second; the next one resumes
        // from the same offset. A stress run is exactly when the API is most
        // likely to be briefly busy, and dropping the page would be the wrong
        // response to the condition the page exists to display.
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), live ? LIVE_POLL_MS : pollWhenIdleMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, pollWhenIdleMs]);

  return { run, samples, isRunning: !!run };
}
