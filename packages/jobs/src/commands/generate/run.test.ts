/**
 * The batch loop's failure handling: one broken rule out of many must not
 * abandon the rules after it, and an AI rule with no usable LLM must be
 * skipped rather than run (and rather than have its existing collections
 * deleted and replaced with nothing).
 *
 * Plex is served by a stubbed `fetch` — the loop only needs identity,
 * sections, and an empty collection list per section to get as far as the
 * per-rule handlers, which is where the interesting behaviour lives.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { setupTempDb } from "../../test-support/temp-db.ts";
import type { JobContext } from "@tinkerbell/core";

setupTempDb();

const { db, rules, config } = await import("@tinkerbell/db");
const { setConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { llmUnavailableReason } = await import("./ai/llm.ts");
const { withItemCache } = await import("./item-cache.ts");
const run = (await import("./index.ts")).default;

const SECTIONS = [
  { key: "1", title: "Films", type: "movie" },
  { key: "2", title: "Shows", type: "show" },
];

const realFetch = globalThis.fetch;

interface PlexStub {
  /** Every path requested, in order. */
  paths: string[];
  /** High-water mark of overlapping section requests — the concurrency probe. */
  maxOverlap: number;
}

/**
 * Minimal Plex server. Every library-content request comes back empty, so
 * nothing is deleted and nothing is created — the rules under test either
 * skip, throw in their handler, or no-op.
 *
 * `delayMs` holds section requests open long enough for overlap to be
 * observable: a rule issues its section requests one at a time, so any
 * overlap at all means two rules were running at once.
 */
function stubPlex({ delayMs = 0 }: { delayMs?: number } = {}): PlexStub {
  const stub: PlexStub = { paths: [], maxOverlap: 0 };
  let inFlight = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    stub.paths.push(url.pathname);
    if (url.pathname === "/") return json({ MediaContainer: { friendlyName: "Test", machineIdentifier: "machine-1" } });
    if (url.pathname === "/library/sections") return json({ MediaContainer: { Directory: SECTIONS } });
    if (url.pathname.startsWith("/library/sections/")) {
      inFlight++;
      stub.maxOverlap = Math.max(stub.maxOverlap, inFlight);
      if (delayMs > 0) await setTimeout(delayMs);
      inFlight--;
      return json({ MediaContainer: { Metadata: [] } });
    }
    throw new Error(`unexpected Plex request: ${url.pathname}`);
  }) as typeof fetch;

  return stub;
}

/**
 * Rules are ordered by `createdAt`, and the point of these tests is what
 * happens to the rules *after* a failure — so the timestamps are set
 * explicitly rather than left to collide within the same millisecond.
 */
function seedRule(name: string, type: string, ruleConfig: Record<string, unknown>, createdAt: number): string {
  const id = `rule-${createdAt}`;
  db.insert(rules).values({ id, name, type, config: ruleConfig, enabled: 1, createdAt }).run();
  return id;
}

function ruleRow(id: string): { lastRunStatus: string | null; lastRunError: string | null } {
  const row = db.select().from(rules).where(eqRule(id)).get();
  return { lastRunStatus: row?.lastRunStatus ?? null, lastRunError: row?.lastRunError ?? null };
}

const { eq } = await import("drizzle-orm");
const eqRule = (id: string) => eq(rules.id, id);

/** A context that records its log so assertions can read what the job said. */
function testContext(signal?: AbortSignal): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: signal ?? new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

beforeEach(() => {
  db.delete(rules).run();
  db.delete(config).run();
  setConfig("global_plex_url", "http://plex.test:32400");
  setConfig("global_plex_token", "token");
  stubPlex();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("llmUnavailableReason", () => {
  it("reports an unconfigured provider", () => {
    const reason = llmUnavailableReason();
    assert.match(reason ?? "", /no LLM provider is configured/i);
  });

  it("reports a provider configured without its API key", () => {
    // The shape that motivated this: a provider saved in Settings, key blank.
    setConfig("global_llm", { provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
    assert.match(llmUnavailableReason() ?? "", /API key/i);
  });

  it("returns null when the provider is usable", () => {
    setConfig("global_llm", { provider: "anthropic", model: "claude-sonnet-4-5-20250929", apiKey: "sk-test" });
    assert.equal(llmUnavailableReason(), null);
  });
});

describe("generate: one bad rule", () => {
  it("skips AI rules when no LLM is configured and keeps going", async () => {
    const ai = seedRule("AI Collections", "ai_prompt", { prompt: "be creative" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    const { ctx, log } = testContext();
    await run(ctx, {});

    const text = log.join("\n");
    assert.match(text, /Skipping AI rule/);
    // Not run, so its last-run record is left exactly as it was.
    assert.equal(ruleRow(ai).lastRunStatus, null);
    // The rule after it still ran.
    assert.equal(ruleRow(after).lastRunStatus, "ok");
  });

  it("records a failing rule and still runs the rest", async () => {
    // Trakt is a recognised provider the handler explicitly rejects — a
    // deterministic handler-level failure that needs no network.
    const broken = seedRule("Broken list", "list_source", { listProvider: "trakt", listId: "abc" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.equal(ruleRow(broken).lastRunStatus, "error");
    assert.match(ruleRow(broken).lastRunError ?? "", /Trakt/i);
    assert.equal(ruleRow(after).lastRunStatus, "ok");

    const text = log.join("\n");
    assert.match(text, /1 of 2 rule\(s\) failed/);
    assert.match(text, /All done!/);
  });

  it("still propagates a failure once the job itself has been cancelled", async () => {
    const broken = seedRule("Broken list", "list_source", { listProvider: "trakt", listId: "abc" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    // Cancel the job at the moment the doomed rule starts fetching, so the
    // rule's failure and an aborted signal arrive together — the case where
    // "keep going" would be wrong.
    const controller = new AbortController();
    const { ctx } = testContext(controller.signal);
    const log = ctx.log;
    ctx.log = (...args: unknown[]) => {
      log(...args);
      if (args.map(String).join(" ").includes("Fetching trakt")) controller.abort();
    };

    // Serial, so "the rules after it" is a meaningful claim — at the default
    // concurrency the later rule would already be in flight.
    await assert.rejects(run(ctx, { ruleConcurrency: 1 }), /Trakt/i);
    assert.equal(ruleRow(broken).lastRunStatus, "error");
    // Cancellation means the rules after it are not attempted.
    assert.equal(ruleRow(after).lastRunStatus, null);
  });
});

describe("generate: rule actions", () => {
  it("a rule with no action key takes the collection path untouched", async () => {
    // Back-compat for every rule that predates the action discriminator. If
    // this ever routes through the cleanup executor, existing installs start
    // queueing their whole library for deletion on the next nightly run.
    const plain = seedRule("Plain", "top_rated", { limit: 5 }, 1);

    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.equal(ruleRow(plain).lastRunStatus, "ok");
    const text = log.join("\n");
    assert.doesNotMatch(text, /\[cleanup\]/, "a rule with no action must never enter the cleanup path");
  });

  it("an explicit collection action is also the collection path", async () => {
    const explicit = seedRule("Explicit", "top_rated", { limit: 5, action: { kind: "collection" } }, 1);

    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.equal(ruleRow(explicit).lastRunStatus, "ok");
    assert.doesNotMatch(log.join("\n"), /\[cleanup\]/);
  });

  it("a cleanup rule routes to the cleanup executor and records rather than acts", async () => {
    seedRule("Reclaim", "top_rated", { limit: 5, action: { kind: "cleanup", mode: "delete" } }, 1);

    const { ctx, log } = testContext();
    await run(ctx, {});

    const text = log.join("\n");
    assert.match(text, /\[cleanup\]/);
    // Nothing is due on a first run, whatever the mode says.
    assert.doesNotMatch(text, /^\[cleanup\] delete:/m);
  });
});

describe("generate: rule concurrency", () => {
  it("overlaps rules by default and still runs every one", async () => {
    const ids = [1, 2, 3].map((n) => seedRule(`Rule ${n}`, "no_such_type", {}, n));
    const stub = stubPlex({ delayMs: 20 });

    const { ctx } = testContext();
    await run(ctx, {});

    assert.ok(stub.maxOverlap > 1, `expected overlapping section requests, saw ${stub.maxOverlap}`);
    for (const id of ids) assert.equal(ruleRow(id).lastRunStatus, "ok");
  });

  it("runs strictly one rule at a time at concurrency 1", async () => {
    const ids = [1, 2, 3].map((n) => seedRule(`Rule ${n}`, "no_such_type", {}, n));
    const stub = stubPlex({ delayMs: 5 });

    const { ctx } = testContext();
    await run(ctx, { ruleConcurrency: 1 });

    assert.equal(stub.maxOverlap, 1);
    for (const id of ids) assert.equal(ruleRow(id).lastRunStatus, "ok");
  });

  it("keeps each rule's log contiguous when they interleave", async () => {
    seedRule("Alpha", "no_such_type", {}, 1);
    seedRule("Beta", "no_such_type", {}, 2);
    stubPlex({ delayMs: 20 });

    const { ctx, log } = testContext();
    await run(ctx, { ruleConcurrency: 2 });

    // Each rule flushes as a single log call, so its header and its section
    // line land in the same entry rather than braided with the other rule's.
    const alpha = log.find((entry) => entry.includes('--- Rule: "Alpha"'));
    assert.ok(alpha, "no log block for Alpha");
    assert.match(alpha, /Sections: Films, Shows/);
    assert.doesNotMatch(alpha, /Beta/);
  });
});

describe("withItemCache", () => {
  function fakeClient(onWalk: () => void) {
    return {
      allItemsWithGuids: async (sectionId: string) => {
        onWalk();
        await setTimeout(1);
        return [{ ratingKey: `${sectionId}-1`, title: "A", guids: [] }];
      },
      fetchAllItems: async () => [],
    } as unknown as Parameters<typeof withItemCache>[0];
  }

  it("walks each section once, however many rules ask", async () => {
    let walks = 0;
    const client = withItemCache(fakeClient(() => walks++));

    await client.allItemsWithGuids("1");
    await client.allItemsWithGuids("1");
    await client.allItemsWithGuids("2");

    assert.equal(walks, 2, "one walk per section");
  });

  it("shares a single in-flight walk between concurrent rules", async () => {
    let walks = 0;
    const client = withItemCache(fakeClient(() => walks++));

    const [a, b] = await Promise.all([client.allItemsWithGuids("1"), client.allItemsWithGuids("1")]);

    assert.equal(walks, 1);
    assert.equal(a, b, "both callers get the same array");
  });

  it("does not cache a failed walk", async () => {
    let attempts = 0;
    const client = withItemCache({
      allItemsWithGuids: async () => {
        attempts++;
        if (attempts === 1) throw new Error("plex blipped");
        return [];
      },
      fetchAllItems: async () => [],
    } as unknown as Parameters<typeof withItemCache>[0]);

    await assert.rejects(client.allItemsWithGuids("1"), /blipped/);
    // The retry gets a real attempt rather than the memoized rejection.
    assert.deepEqual(await client.allItemsWithGuids("1"), []);
    assert.equal(attempts, 2);
  });
});
