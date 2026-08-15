/**
 * Shared shapes for the "this loop is a queue of round-trips" problem, which
 * every long-running job in here has some version of.
 */
import PQueue from "p-queue";

/**
 * Drain an async iterable with a fixed number of consumers in flight.
 *
 * Written for rule handlers, which yield collections faster than they can be
 * committed: a grouped rule produces hundreds, and each commit is several Plex
 * round-trips, so consuming them one at a time makes the job latency-bound.
 *
 * Concurrent `next()` calls on an async generator are queued by the runtime,
 * so the *producer* still runs serially — only `consume` overlaps.
 */
export async function drainConcurrently<T>(
  source: AsyncIterable<T>,
  concurrency: number,
  consume: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  // Once one consumer has thrown the caller is going to see that error, so
  // stop pulling work the caller has no use for.
  let failed = false;

  const worker = async (): Promise<void> => {
    try {
      while (!failed) {
        signal?.throwIfAborted();
        const next = await iterator.next();
        if (next.done) return;
        await consume(next.value);
      }
    } catch (err) {
      failed = true;
      throw err;
    }
  };

  // `allSettled`, not `all`: a sibling worker's rejection must still be
  // observed, or it surfaces as an unhandled rejection with nothing to catch
  // it — inside a Sidequest worker thread that takes the whole thread down.
  const outcomes = await Promise.allSettled(Array.from({ length: Math.max(1, concurrency) }, worker));

  // Whatever the producer is still holding open (Plex paging, an LLM stream)
  // gets its `finally` — `for await` used to do this on our behalf. Its own
  // cleanup failing mustn't mask the consumer error that caused the unwind.
  try {
    await iterator.return?.(undefined);
  } catch {
    // ignored deliberately
  }

  const rejected = outcomes.find((o) => o.status === "rejected");
  if (rejected) throw rejected.reason;
}

/**
 * `items.map(fn)` with a ceiling on how many run at once, results in input
 * order. The first rejection wins, as with `Promise.all`.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const queue = new PQueue({ concurrency: Math.max(1, concurrency) });
  return Promise.all(items.map((item, i) => queue.add(() => fn(item, i)) as Promise<R>));
}

/**
 * Split a list into fixed-size runs.
 *
 * Pairs with `mapConcurrent` where a loop can stop early: fetching the whole
 * list up front is wasted work when the caller only needs the first few
 * results, so a chunk at a time keeps the parallelism without the waste.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) {
    out.push(items.slice(i, i + Math.max(1, size)));
  }
  return out;
}
