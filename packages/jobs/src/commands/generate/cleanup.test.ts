/**
 * The cleanup gates.
 *
 * Every test here is about something *not* happening. The executor's whole job
 * is deciding when a scheduled task is allowed to delete a file, and each of
 * these gates exists because the alternative is unrecoverable: there is no
 * undo, and the person who finds out is the one whose film is gone.
 *
 * Plex and *Arr are both stubbed at `fetch`, and the stub throws on any
 * destructive request unless a test explicitly allows it — so a regression
 * that lets a delete slip through a gate fails loudly rather than quietly
 * passing.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";

setupTempDb("tinkerbell-cleanup-job-test-");

const { db, rules, config, jobs, jobRuns, cleanupCandidates, events } = await import("@tinkerbell/db");
const { setConfig } = await import("@tinkerbell/core");
const { noopCheckpoint } = await import("@tinkerbell/core");
const { recordMatches, listCandidates, holdCandidate } = await import("@tinkerbell/domain.cleanup");
const { runHandlerWithCleanup, createCleanupBudget, CLEANUP_LABEL } = await import("./cleanup.ts");
const { createPlexClient } = await import("@tinkerbell/plex");

const RULE_ID = "cleanup-rule";
const DAY = 86_400_000;
const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

const realFetch = globalThis.fetch;

interface ArrCalls {
  deletes: string[];
  puts: string[];
  labelPuts: string[];
  collectionsCreated: number;
}

/**
 * Plex + Radarr in one stub.
 *
 * `allowDestructive` defaults to false and makes any DELETE or monitor-PUT
 * throw. A test that expects nothing to happen therefore fails on the request
 * itself rather than on a count assertion that could be satisfied for the
 * wrong reason.
 */
function stubServers({
  allowDestructive = false,
  sectionTotal = 1000,
}: { allowDestructive?: boolean; sectionTotal?: number } = {}): ArrCalls {
  const calls: ArrCalls = { deletes: [], puts: [], labelPuts: [], collectionsCreated: 0 };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    // ── Radarr ──
    if (url.port === "7878") {
      if (method === "DELETE") {
        if (!allowDestructive) throw new Error(`unexpected Radarr DELETE ${url.pathname}${url.search}`);
        calls.deletes.push(`${url.pathname}${url.search}`);
        return new Response(null, { status: 200 });
      }
      if (method === "PUT") {
        if (!allowDestructive) throw new Error(`unexpected Radarr PUT ${url.pathname}`);
        calls.puts.push(url.pathname);
        return json({});
      }
      if (url.pathname === "/api/v3/movie") {
        return json([{ id: 7, title: "The Matrix", tmdbId: 603, monitored: true, hasFile: true }]);
      }
      return json([]);
    }

    // ── Plex ──
    if (url.pathname === "/") {
      return json({ MediaContainer: { friendlyName: "Test", machineIdentifier: "machine-1" } });
    }
    if (url.pathname === "/library/sections") return json({ MediaContainer: { Directory: SECTIONS } });
    if (url.pathname.startsWith("/library/metadata/")) {
      if (method === "DELETE") {
        if (!allowDestructive) throw new Error(`unexpected Plex DELETE ${url.pathname}`);
        calls.deletes.push(url.pathname);
        return new Response(null, { status: 200 });
      }
      if (method === "PUT") {
        calls.labelPuts.push(url.pathname);
        return json({});
      }
      return json({
        MediaContainer: {
          Metadata: [{ ratingKey: "100", title: "The Matrix", Guid: [{ id: "tmdb://603" }], Label: [] }],
        },
      });
    }
    if (url.pathname.startsWith("/library/collections")) {
      calls.collectionsCreated++;
      return json({ MediaContainer: { Metadata: [{ ratingKey: "col-1" }] } });
    }
    if (url.pathname.startsWith("/library/sections/")) {
      if (method === "PUT") return json({});
      return json({ MediaContainer: { totalSize: sectionTotal, Metadata: [] } });
    }
    return json({ MediaContainer: {} });
  }) as typeof fetch;

  return calls;
}

function testContext(): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

/** A handler yielding a fixed match set, standing in for a real selection. */
function handlerYielding(items: Array<{ ratingKey: string; title: string }>) {
  return async function* () {
    yield { section: SECTIONS[0], matched: items };
  } as never;
}

function cleanupAction(over: Record<string, unknown> = {}) {
  return {
    kind: "cleanup" as const,
    mode: "delete" as const,
    consecutiveRuns: 3,
    maxActionsPerRun: 25,
    viaArr: true,
    addImportExclusion: false,
    dryRun: false,
    ...over,
  };
}

function deps(ctx: JobContext) {
  return {
    ctx,
    client: createPlexClient({ url: "http://plex.test:32400", token: "t" }),
    sections: SECTIONS,
    rule: { id: RULE_ID, name: "Reclaim", type: "smart_filter" },
    ruleConfig: {},
  } as never;
}

/**
 * Bring items to the brink: matched enough runs to be due on the next one.
 *
 * Every item must be primed in the *same* calls — `recordMatches` prunes rows
 * that stopped matching, so priming one key at a time would delete the
 * previous key's row each time, which is the behaviour under test elsewhere.
 */
function primeStreaks(items: Array<{ ratingKey: string; title: string }>, runs: number): void {
  for (let i = 0; i < runs; i++) {
    recordMatches(
      RULE_ID,
      items.map((it) => ({ ratingKey: it.ratingKey, sectionId: "1", title: it.title })),
      Date.now() - (runs - i) * DAY,
    );
  }
}

/** Single-item convenience over `primeStreaks`. */
function primeStreak(ratingKey: string, title: string, runs: number): void {
  primeStreaks([{ ratingKey, title }], runs);
}

/** Mark sync-media as having completed `agoMs` ago. */
function seedSyncRun(agoMs: number | null): void {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .run();
  if (agoMs == null) return;
  db.insert(jobRuns)
    .values({
      id: `run-${agoMs}`,
      jobId: "sync-media",
      status: "completed",
      startedAt: Date.now() - agoMs,
      finishedAt: Date.now() - agoMs,
    })
    .run();
}

beforeEach(() => {
  db.delete(cleanupCandidates).run();
  db.delete(events).run();
  db.delete(rules).run();
  db.delete(config).run();
  db.insert(rules)
    .values({ id: RULE_ID, name: "Reclaim", type: "smart_filter", config: {}, enabled: 1, createdAt: Date.now() })
    .run();

  setConfig("global_plex_url", "http://plex.test:32400");
  setConfig("global_plex_token", "token");
  setConfig("global_radarr_url", "http://arr.test:7878");
  setConfig("global_radarr_api_key", "key");
  setConfig("cleanup_enabled", true);
  seedSyncRun(60_000); // synced a minute ago
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── The streak gate ─────────────────────────────────────────────────────────

describe("streak", () => {
  it("does nothing destructive on the run that first matched an item", async () => {
    const calls = stubServers(); // throws on any destructive request
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.deepEqual(calls.deletes, []);
    assert.match(log.join("\n"), /Nothing due yet/);
    assert.equal(listCandidates(RULE_ID)[0].streak, 1);
  });

  it("acts once the streak reaches the threshold", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    assert.equal(calls.deletes.length, 1);
    assert.match(calls.deletes[0], /^\/api\/v3\/movie\/7\?/, "deletes the *Arr record, not the Plex item");
  });
});

// ─── The dry-run gate ────────────────────────────────────────────────────────

describe("dryRun", () => {
  it("builds the queue collection and performs no mutation", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers(); // any delete throws
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: true }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.ok(calls.collectionsCreated > 0, "the shelf is built in every mode, including dry run");
    assert.match(log.join("\n"), /DRY RUN.*would delete: "The Matrix"/s);
    assert.equal(listCandidates(RULE_ID)[0].actionedAt, null);
  });
});

// ─── The global kill switch ──────────────────────────────────────────────────

describe("cleanup_enabled", () => {
  it("blocks destructive modes regardless of rule config", async () => {
    setConfig("cleanup_enabled", false);
    primeStreak("100", "The Matrix", 2);
    stubServers();
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.match(out.refusal ?? "", /disabled globally/);
    assert.match(log.join("\n"), /REFUSING/);
  });

  it("does not block the non-destructive modes — that's how people try it out", async () => {
    setConfig("cleanup_enabled", false);
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers();
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label", dryRun: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    assert.ok(calls.labelPuts.length > 0);
    assert.deepEqual(calls.deletes, []);
  });
});

// ─── The global ceiling ──────────────────────────────────────────────────────

describe("global per-run ceiling", () => {
  it("stops at the shared budget even when each rule is under its own cap", async () => {
    // Three items due, a per-rule cap of 30, but only two left in the run.
    primeStreaks(
      [
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
        { ratingKey: "300", title: "Film 300" },
      ],
      2,
    );
    const calls = stubServers({ allowDestructive: true });
    const { ctx, log } = testContext();

    const budget = createCleanupBudget();
    budget.remaining = 2;

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ maxActionsPerRun: 30 }),
      "machine-1",
      ["Tinkerbell"],
      budget,
      handlerYielding([
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
        { ratingKey: "300", title: "Film 300" },
      ]),
    );

    assert.equal(out.actioned, 2);
    assert.equal(calls.deletes.length, 2);
    assert.equal(budget.remaining, 0);
    assert.match(log.join("\n"), /Global per-run limit reached/);
    // The third is untouched and still queued for next time.
    assert.equal(listCandidates(RULE_ID).filter((c) => c.actionedAt == null).length, 1);
  });

  it("the budget is shared, so a second rule inherits what the first left", async () => {
    primeStreaks(
      [
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
      ],
      2,
    );
    stubServers({ allowDestructive: true });
    const { ctx } = testContext();
    const budget = createCleanupBudget();
    budget.remaining = 1;

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      budget,
      handlerYielding([
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
      ]),
    );

    assert.equal(budget.remaining, 0, "the next rule in the run gets nothing");
  });

  it("non-destructive modes don't consume the delete budget", async () => {
    primeStreak("100", "The Matrix", 2);
    stubServers();
    const { ctx } = testContext();
    const budget = createCleanupBudget();
    const before = budget.remaining;

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label" }),
      "machine-1",
      ["Tinkerbell"],
      budget,
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(budget.remaining, before);
  });
});

// ─── The fraction guard ──────────────────────────────────────────────────────

describe("implausible match fraction", () => {
  it("records candidates but actions nothing when a rule matches too much of the library", async () => {
    // 30 of 100 items — over the 25% line. The realistic shape of "the smart
    // filter had a typo".
    const items = Array.from({ length: 30 }, (_, i) => ({ ratingKey: `k${i}`, title: `Film ${i}` }));
    primeStreaks(items, 2);

    const calls = stubServers({ sectionTotal: 100 });
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding(items),
    );

    assert.equal(out.actioned, 0);
    assert.deepEqual(calls.deletes, []);
    assert.match(out.refusal ?? "", /reads as a filter mistake/);
    assert.match(log.join("\n"), /30 of 100 items \(30%\)/);
    // Candidates are still recorded — the queue page should show the problem.
    assert.equal(listCandidates(RULE_ID).length, 30);
  });

  it("allows a normal-sized match set", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ ratingKey: `k${i}`, title: `Film ${i}` }));
    primeStreaks(items, 2);
    const calls = stubServers({ allowDestructive: true, sectionTotal: 100 });
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding(items),
    );

    assert.equal(out.actioned, 5);
    assert.equal(calls.deletes.length, 5);
  });
});

// ─── The staleness guard ─────────────────────────────────────────────────────

describe("library index staleness", () => {
  it("refuses when sync-media last succeeded more than 48h ago", async () => {
    seedSyncRun(3 * DAY);
    primeStreak("100", "The Matrix", 2);
    stubServers();
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.match(out.refusal ?? "", /last synced 3 day\(s\) ago/);
    assert.match(log.join("\n"), /REFUSING/);
  });

  it("refuses when the library has never synced at all", async () => {
    seedSyncRun(null);
    primeStreak("100", "The Matrix", 2);
    stubServers();
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.match(out.refusal ?? "", /never been synced/);
  });
});

// ─── Plex-only deletes ───────────────────────────────────────────────────────

describe("viaArr", () => {
  it("refuses a Plex-only delete when *Arr is the configured route but has no record", async () => {
    primeStreak("100", "The Matrix", 2);
    // Radarr returns an empty library, so no record matches.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE") throw new Error("must not delete without an *Arr record");
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.port === "7878") return json([]);
      if (url.pathname === "/") return json({ MediaContainer: { machineIdentifier: "m", friendlyName: "t" } });
      if (url.pathname.startsWith("/library/metadata/")) {
        return json({ MediaContainer: { Metadata: [{ ratingKey: "100", Guid: [{ id: "tmdb://603" }], Label: [] }] } });
      }
      if (url.pathname.startsWith("/library/collections")) {
        return json({ MediaContainer: { Metadata: [{ ratingKey: "col-1" }] } });
      }
      return json({ MediaContainer: { totalSize: 1000, Metadata: [] } });
    }) as typeof fetch;

    const { ctx, log } = testContext();
    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ viaArr: true }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    // A Plex-only delete would leave Radarr to re-download it that night.
    assert.equal(out.actioned, 0);
    assert.match(log.join("\n"), /FAILED to delete .*re-downloaded/);
    assert.equal(listCandidates(RULE_ID)[0].actionedAt, null, "stays queued so the next run retries");
  });

  it("deletes through Plex when the rule opts out of *Arr", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ viaArr: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    assert.deepEqual(calls.deletes, ["/library/metadata/100"]);
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe("cleanup.pending", () => {
  function eventTypes(): string[] {
    return db
      .select({ type: events.type })
      .from(events)
      .all()
      .map((r) => r.type);
  }

  it("warns the run before, while there is still time to say no", async () => {
    // One short of the threshold: these go on the *next* run.
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(eventTypes().includes("cleanup.pending"));
    const row = db.select().from(events).all().at(-1);
    assert.match(row?.message ?? "", /will delete 1 item\(s\) on its next run/);
    assert.match(row?.message ?? "", /The Matrix/);
  });

  it("says nothing when the rule is in preview-only mode", async () => {
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: true }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));
  });

  it("says nothing for a non-destructive mode", async () => {
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label", consecutiveRuns: 3, dryRun: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));
  });

  it("does not warn about an item somebody has kept", async () => {
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    holdCandidate(RULE_ID, "100", Date.now() + 30 * DAY);
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: false }),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));
  });

  it("reports what was actioned after the fact", async () => {
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 2);
    stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(eventTypes().includes("cleanup.actioned"));
  });
});

// ─── The shelf ───────────────────────────────────────────────────────────────

describe("queue collection", () => {
  it("carries the cleanup label so it can be found in Plex", async () => {
    stubServers();
    const { ctx } = testContext();
    let labelSeen = false;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.search.includes(encodeURIComponent(CLEANUP_LABEL))) labelSeen = true;
      return inner(input as never, init as never);
    }) as typeof fetch;

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      "machine-1",
      ["Tinkerbell"],
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(labelSeen, `expected a request carrying the ${CLEANUP_LABEL} label`);
  });
});
