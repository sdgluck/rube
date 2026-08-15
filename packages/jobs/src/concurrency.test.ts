/**
 * The concurrency primitives the jobs run on. Overlapping round-trips is the
 * easy half; the properties worth pinning are what happens at the edges — a
 * failure half way through must still fail, a cancelled job must stop pulling
 * work, an async producer must never be re-entered, and results must not
 * silently reorder themselves just because they finished out of order.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { chunked, drainConcurrently, mapConcurrent } from "./concurrency.ts";

async function* range(n: number): AsyncGenerator<number> {
  for (let i = 0; i < n; i++) yield i;
}

describe("drainConcurrently", () => {
  it("overlaps consumers and still consumes every item exactly once", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    await drainConcurrently(range(20), 4, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await setTimeout(5);
      inFlight--;
      seen.push(n);
    });

    assert.equal(maxInFlight, 4);
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it("never re-enters the producer concurrently", async () => {
    let producing = false;
    async function* guarded(): AsyncGenerator<number> {
      for (let i = 0; i < 20; i++) {
        assert.equal(producing, false, "generator body re-entered");
        producing = true;
        await setTimeout(1);
        producing = false;
        yield i;
      }
    }

    await drainConcurrently(guarded(), 4, async () => {
      await setTimeout(2);
    });
  });

  it("propagates a consumer failure and stops pulling new work", async () => {
    let produced = 0;
    async function* counted(): AsyncGenerator<number> {
      for (let i = 0; i < 1000; i++) {
        produced++;
        yield i;
      }
    }

    await assert.rejects(
      drainConcurrently(counted(), 4, async (n) => {
        await setTimeout(1);
        if (n === 2) throw new Error("commit failed");
      }),
      /commit failed/,
    );

    // The pool gives up rather than working through the remaining 997.
    assert.ok(produced < 100, `expected the pool to stop early, produced ${produced}`);
  });

  it("runs the producer's cleanup when it gives up early", async () => {
    let cleanedUp = false;
    async function* withFinally(): AsyncGenerator<number> {
      try {
        for (let i = 0; i < 100; i++) yield i;
      } finally {
        cleanedUp = true;
      }
    }

    await assert.rejects(
      drainConcurrently(withFinally(), 2, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(cleanedUp, true);
  });

  it("stops on an aborted signal", async () => {
    const controller = new AbortController();
    let consumed = 0;

    await assert.rejects(
      drainConcurrently(
        range(1000),
        2,
        async () => {
          consumed++;
          if (consumed === 5) controller.abort();
          await setTimeout(1);
        },
        controller.signal,
      ),
      (err: Error) => err.name === "AbortError",
    );
    assert.ok(consumed < 100, `expected an early stop, consumed ${consumed}`);
  });
});

describe("mapConcurrent", () => {
  it("returns results in input order however they finish", async () => {
    // Reverse-ordered delays: without ordering, the first result would be last.
    const out = await mapConcurrent([30, 20, 10, 0], 4, async (ms, i) => {
      await setTimeout(ms);
      return `${i}:${ms}`;
    });

    assert.deepEqual(out, ["0:30", "1:20", "2:10", "3:0"]);
  });

  it("holds to the ceiling", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapConcurrent(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await setTimeout(4);
        inFlight--;
      },
    );

    assert.equal(maxInFlight, 3);
  });

  it("rejects with the first failure", async () => {
    await assert.rejects(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("nope");
        return n;
      }),
      /nope/,
    );
  });
});

describe("chunked", () => {
  it("splits into runs of the requested size, remainder last", () => {
    assert.deepEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunked([1, 2], 5), [[1, 2]]);
    assert.deepEqual(chunked([], 3), []);
  });
});
