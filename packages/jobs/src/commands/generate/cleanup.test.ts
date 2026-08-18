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

const { db, rules, config, jobs, jobRuns, cleanupCandidates, cleanupProtections, events } =
  await import("@tinkerbell/db");
const { setConfig } = await import("@tinkerbell/core");
const { noopCheckpoint } = await import("@tinkerbell/core");
const { recordMatches, listCandidates, holdCandidate, markActioned, setCandidateApproval, addProtection } =
  await import("@tinkerbell/domain.cleanup");
const { runHandlerWithCleanup, createCleanupBudget } = await import("./cleanup.ts");
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
      // A PUT here would be the wrong endpoint for a library item; nothing
      // should send one, so it is not handled.
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
      // Plex's tag-edit endpoint for a library item is the section `/all` PUT
      // carrying `type` and `id` — not a PUT to /library/metadata/:key, which
      // answers 200 and applies nothing.
      if (method === "PUT") {
        if (url.searchParams.has("label[0].tag.tag")) calls.labelPuts.push(url.searchParams.get("id") ?? "");
        return json({});
      }
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
    requireApproval: false,
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
  db.delete(cleanupProtections).run();
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
  it("performs no mutation", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers(); // any delete throws
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.equal(calls.collectionsCreated, 0);
    assert.match(log.join("\n"), /DRY RUN.*would delete: "The Matrix"/s);
    assert.equal(listCandidates(RULE_ID)[0].actionedAt, null);
  });
});

// ─── The approval gate ───────────────────────────────────────────────────────

describe("requireApproval", () => {
  it("leaves a due item alone until somebody says yes to it", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers(); // any delete throws
    const { ctx, log } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.deepEqual(calls.deletes, []);
    assert.match(log.join("\n"), /waiting for approval/);
    // Still queued, not consumed: the streak survives so the item is due
    // again the moment it is approved.
    assert.equal(listCandidates(RULE_ID)[0].actionedAt, null);
  });

  it("acts once the item is approved", async () => {
    primeStreak("100", "The Matrix", 2);
    setCandidateApproval(RULE_ID, "100", true);
    const calls = stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    assert.equal(calls.deletes.length, 1);
  });

  it("approves one item without approving its neighbours", async () => {
    primeStreaks(
      [
        { ratingKey: "100", title: "The Matrix" },
        { ratingKey: "200", title: "Heat" },
      ],
      2,
    );
    setCandidateApproval(RULE_ID, "100", true);
    stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([
        { ratingKey: "100", title: "The Matrix" },
        { ratingKey: "200", title: "Heat" },
      ]),
    );

    assert.equal(out.actioned, 1);
    assert.equal(listCandidates(RULE_ID).find((c) => c.ratingKey === "200")?.actionedAt, null);
  });

  it("is ignored by a non-destructive mode — there is nothing to approve", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers();
    const { ctx } = testContext();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label", dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    assert.equal(calls.deletes.length, 0);
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
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 1);
    // The shelf collection is labelled through the same endpoint, so assert on
    // the item's own id being among them rather than on the exact set.
    assert.ok(calls.labelPuts.includes("100"), `expected a label PUT for item 100, saw ${calls.labelPuts.join(", ")}`);
    assert.deepEqual(calls.deletes, []);
  });
});

// ─── The global ceiling ──────────────────────────────────────────────────────

describe("global daily ceiling", () => {
  it("counts spend from the ledger, so a second budget can't refill it", async () => {
    // The property the per-run counter never had. It bounded one batch: an
    // ad-hoc `runSingleRule` took a fresh full budget, and cleanup now has its
    // own job as well. Two budgets in the same day must share one allowance.
    setConfig("cleanup_max_deletes_per_day", 2);
    primeStreaks(
      [
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
      ],
      2,
    );
    stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    const first = createCleanupBudget();
    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      first,
      handlerYielding([
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
      ]),
    );

    // A brand-new budget, as a separate job or an ad-hoc run would create.
    const second = createCleanupBudget();
    assert.equal(second.remaining(), 0, "the day's allowance is already spent");
    assert.equal(second.reserve(), false);
  });

  it("lets spend outside the window age out", () => {
    setConfig("cleanup_max_deletes_per_day", 2);
    primeStreaks([{ ratingKey: "100", title: "Film 100" }], 2);
    markActioned(RULE_ID, "100", "delete", Date.now() - 25 * 60 * 60 * 1000);

    assert.equal(createCleanupBudget().remaining(), 2, "yesterday's deletions don't count against today");
  });

  it("ignores non-destructive actions when counting spend", () => {
    setConfig("cleanup_max_deletes_per_day", 2);
    primeStreaks([{ ratingKey: "100", title: "Film 100" }], 2);
    markActioned(RULE_ID, "100", "label");

    assert.equal(createCleanupBudget().remaining(), 2, "labelling removed nothing, so it spent nothing");
  });

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

    setConfig("cleanup_max_deletes_per_day", 2);
    const budget = createCleanupBudget();

    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ maxActionsPerRun: 30 }),
      budget,
      handlerYielding([
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
        { ratingKey: "300", title: "Film 300" },
      ]),
    );

    assert.equal(out.actioned, 2);
    assert.equal(calls.deletes.length, 2);
    assert.equal(budget.remaining(), 0);
    assert.match(log.join("\n"), /Daily limit reached/);
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
    setConfig("cleanup_max_deletes_per_day", 1);
    const budget = createCleanupBudget();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      budget,
      handlerYielding([
        { ratingKey: "100", title: "Film 100" },
        { ratingKey: "200", title: "Film 200" },
      ]),
    );

    assert.equal(budget.remaining(), 0, "the next rule in the run gets nothing");
  });

  it("non-destructive modes don't consume the delete budget", async () => {
    primeStreak("100", "The Matrix", 2);
    stubServers();
    const { ctx } = testContext();
    const budget = createCleanupBudget();
    const before = budget.remaining();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label" }),
      budget,
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(budget.remaining(), before);
  });

  it("reserves the slot before acting, so concurrent rules can't overshoot", async () => {
    // The check and the decrement must not straddle the await: up to eight
    // rules share this object, and checking before while decrementing after
    // lets all eight pass a `remaining: 1` check and all eight delete.
    primeStreaks([{ ratingKey: "100", title: "Film 100" }], 2);
    let inFlight = 0;
    let sawRemainingDuringDelete: number | null = null;
    setConfig("cleanup_max_deletes_per_day", 1);
    const budget = createCleanupBudget();

    stubServers({ allowDestructive: true });
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if ((init?.method ?? "GET").toUpperCase() === "DELETE" && url.port === "7878") {
        inFlight++;
        sawRemainingDuringDelete = budget.remaining();
      }
      return inner(input as never, init as never);
    }) as typeof fetch;

    const { ctx } = testContext();
    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      budget,
      handlerYielding([{ ratingKey: "100", title: "Film 100" }]),
    );

    assert.equal(inFlight, 1);
    assert.equal(sawRemainingDuringDelete, 0, "the slot is spent before the request goes out, not after it returns");
  });

  it("hands the slot back when the action fails", async () => {
    primeStreaks([{ ratingKey: "100", title: "Film 100" }], 2);
    // Radarr has no matching record, so the delete refuses.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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

    const budget = createCleanupBudget();
    const before = budget.remaining();
    const { ctx } = testContext();
    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      budget,
      handlerYielding([{ ratingKey: "100", title: "Film 100" }]),
    );

    assert.equal(budget.remaining(), before, "a run of failures must not eat the whole budget");
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

    const out = await runHandlerWithCleanup(deps(ctx), cleanupAction(), createCleanupBudget(), handlerYielding(items));

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

    const out = await runHandlerWithCleanup(deps(ctx), cleanupAction(), createCleanupBudget(), handlerYielding(items));

    assert.equal(out.actioned, 5);
    assert.equal(calls.deletes.length, 5);
  });
});

describe("unsizeable library", () => {
  it("refuses rather than skipping the guard when Plex can't be asked how big it is", async () => {
    // Without a denominator the fraction check has nothing to compare against.
    // Treating that as "0 items, so 0% matched" would switch the guard off at
    // exactly the moment Plex is unhealthy and a filter is most suspect.
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 2);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE") throw new Error("must not delete with the guard disabled");
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.pathname === "/") return json({ MediaContainer: { machineIdentifier: "m", friendlyName: "t" } });
      if (url.pathname.startsWith("/library/collections")) {
        return json({ MediaContainer: { Metadata: [{ ratingKey: "col-1" }] } });
      }
      // Every sizing request fails.
      if (url.pathname.startsWith("/library/sections/")) return new Response("boom", { status: 500 });
      return json({ MediaContainer: {} });
    }) as typeof fetch;

    const { ctx } = testContext();
    const out = await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(out.actioned, 0);
    assert.match(out.refusal ?? "", /could not be asked how large the library is/);
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
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));
  });

  it("does not warn about an item that is protected", async () => {
    // Protection means never, so naming the title in a "goes on the next run"
    // message is a false alarm — and a channel that cries wolf gets muted.
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    addProtection("item", "100", "The Matrix");
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: false }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));
  });

  it("does not warn about an item waiting on an approval", async () => {
    // An approval-gated rule removes nothing until a human says so, so "on its
    // next run" is not true of an unapproved item.
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 1);
    stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(!eventTypes().includes("cleanup.pending"));

    // Approved, and the warning is true again. The streak doesn't move — it
    // advances once a day — so the same threshold still puts this item one run
    // short, which is the state the warning is about.
    setCandidateApproval(RULE_ID, "100", true);
    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ consecutiveRuns: 3, dryRun: false, requireApproval: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );
    assert.ok(eventTypes().includes("cleanup.pending"));
  });

  it("reports what was actioned after the fact", async () => {
    primeStreaks([{ ratingKey: "100", title: "The Matrix" }], 2);
    stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction(),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.ok(eventTypes().includes("cleanup.actioned"));
  });
});

// ─── No collections ──────────────────────────────────────────────────────────

/**
 * Cleanup used to build a shelf collection per section. It doesn't any more:
 * a rule matching badly put a collection of most of the library in front of
 * the household before anyone had agreed to anything, and the review surface
 * is Tinkerbell's own queue page. These tests are what stops it coming back.
 */
describe("no Plex collections", () => {
  it("writes no collection in any mode", async () => {
    for (const mode of ["collection_only", "label", "unmonitor", "delete"] as const) {
      db.delete(cleanupCandidates).run();
      primeStreak("100", "The Matrix", 2);
      const calls = stubServers({ allowDestructive: true });
      const { ctx } = testContext();

      await runHandlerWithCleanup(
        deps(ctx),
        cleanupAction({ mode }),
        createCleanupBudget(),
        handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
      );

      assert.equal(calls.collectionsCreated, 0, `${mode} must not create a collection`);
    }
  });

  it("writes no collection on a dry run either", async () => {
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers();
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ dryRun: true }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.equal(calls.collectionsCreated, 0);
  });

  it("still labels the items themselves in label mode", async () => {
    // The one Plex write cleanup still makes. Item labels, not collections.
    primeStreak("100", "The Matrix", 2);
    const calls = stubServers({ allowDestructive: true });
    const { ctx } = testContext();

    await runHandlerWithCleanup(
      deps(ctx),
      cleanupAction({ mode: "label" }),
      createCleanupBudget(),
      handlerYielding([{ ratingKey: "100", title: "The Matrix" }]),
    );

    assert.deepEqual(calls.labelPuts, ["100"]);
    assert.equal(calls.collectionsCreated, 0);
  });
});
