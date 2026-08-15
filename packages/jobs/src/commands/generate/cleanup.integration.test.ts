/**
 * The cleanup feature end to end, through the real `generate` job.
 *
 * The other cleanup tests call `runHandlerWithCleanup` directly with a fake
 * handler and a stubbed `fetch`. That is the right shape for the gate logic,
 * but it skips the whole spine: connecting to Plex, resolving sections,
 * deleting the previous run's collections, the dispatch seam that chooses an
 * ending, the real smart-filter handler building a real query, the real Plex
 * and *Arr clients putting real requests on the wire, and the ledger surviving
 * between separate invocations of the job.
 *
 * So this drives `runCleanup()` — the actual entry point the scheduler calls
 * for a cleanup rule — three times against real HTTP mock servers, and asserts on what those servers were
 * actually asked to do. The manual verification in `media-lifecycle.md` asks
 * for exactly this sequence: run it three times under dry run, confirm the
 * shelf and the logs, then turn dry run off and confirm precisely the expected
 * items are removed from both Radarr and Plex.
 *
 * What it cannot do is tell you that real Plex and real Radarr agree with the
 * mocks about endpoint semantics. That is still an open item.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";
import type { MockArr } from "../../test-support/mock-arr-server.ts";

setupTempDb("tinkerbell-cleanup-e2e-");

const { db, rules, config, jobs, jobRuns, cleanupCandidates, events } = await import("@tinkerbell/db");
const { setConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { listCandidates } = await import("@tinkerbell/domain.cleanup");
const { startMockPlex } = await import("../../test-support/mock-plex-server.ts");
const { startMockRadarr } = await import("../../test-support/mock-arr-server.ts");
// The batch jobs are split by ending, so there are two entry points: the
// `cleanup` job owns these rules, and `generate` owns the collection rule the
// back-compat test at the bottom uses as its control.
const { runCleanup, default: runGenerateJob } = await import("./index.ts");

const RULE_ID = "e2e-cleanup";
const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

/**
 * Twelve films, of which three are Horror. The rule selects on genre, so the
 * match set is a deliberate quarter-ish of the library — under the 25% guard,
 * which is itself asserted separately.
 */
const ITEMS = [
  { ratingKey: "100", title: "The Descent", genre: "Horror", tmdbId: 9392 },
  { ratingKey: "101", title: "Hereditary", genre: "Horror", tmdbId: 493922 },
  { ratingKey: "102", title: "The Witch", genre: "Horror", tmdbId: 310131 },
  ...Array.from({ length: 9 }, (_, i) => ({
    ratingKey: String(200 + i),
    title: `Comedy ${i}`,
    genre: "Comedy",
    tmdbId: 1000 + i,
  })),
];

let plex: MockPlex;
let arr: MockArr;

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

/** Boot fresh mocks so each test starts from an unmutated library. */
async function freshServers(): Promise<void> {
  await plex?.close();
  await arr?.close();
  plex = await startMockPlex({
    sections: SECTIONS,
    items: ITEMS.map((i) => ({
      ratingKey: i.ratingKey,
      title: i.title,
      sectionId: "1",
      genre: i.genre,
      guids: [`tmdb://${i.tmdbId}`],
      labels: [],
    })),
  });
  arr = await startMockRadarr(
    ITEMS.map((i, idx) => ({
      id: idx + 1,
      title: i.title,
      tmdbId: i.tmdbId,
      monitored: true,
      hasFile: true,
    })),
  );
  setConfig("global_plex_url", plex.origin);
  setConfig("global_radarr_url", arr.origin);
}

function seedRule(action: Record<string, unknown>): void {
  db.delete(rules).run();
  db.insert(rules)
    .values({
      id: RULE_ID,
      name: "Reclaim horror",
      type: "smart_filter",
      enabled: 1,
      createdAt: Date.now(),
      config: {
        smartFilter: {
          kind: "group",
          combinator: "all",
          children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
        },
        action,
        pinToHomepage: false,
      },
    })
    .run();
}

/** A recent successful sync-media, so the staleness guard is satisfied. */
function seedFreshIndex(): void {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .run();
  db.insert(jobRuns)
    .values({
      id: "sync-1",
      jobId: "sync-media",
      status: "completed",
      startedAt: Date.now() - 60_000,
      finishedAt: Date.now() - 60_000,
    })
    .run();
}

async function runGenerate(): Promise<string[]> {
  const { ctx, log } = testContext();
  await runCleanup(ctx, {});
  return log;
}

/** The other job, for asserting a collection rule is unaffected by all this. */
async function runCollections(): Promise<string[]> {
  const { ctx, log } = testContext();
  await runGenerateJob(ctx, {});
  return log;
}

before(async () => {
  await freshServers();
});

after(async () => {
  await plex?.close();
  await arr?.close();
});

beforeEach(async () => {
  db.delete(cleanupCandidates).run();
  db.delete(events).run();
  db.delete(config).run();
  await freshServers();
  setConfig("global_plex_token", "token");
  setConfig("global_radarr_api_key", "key");
  setConfig("cleanup_enabled", true);
  seedFreshIndex();
});

// ─── The full three-run sequence ─────────────────────────────────────────────

describe("a cleanup rule across three real runs", () => {
  it("queues on the first two runs and removes on the third", async () => {
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });

    // ── Run 1 ──
    const log1 = await runGenerate();
    assert.match(log1.join("\n"), /\[cleanup\] "Reclaim horror" matched 3 item\(s\)/);
    assert.match(log1.join("\n"), /Nothing due yet/);
    assert.deepEqual(
      listCandidates(RULE_ID).map((c) => c.streak),
      [1, 1, 1],
    );
    assert.deepEqual(arr.journal.deletes, [], "nothing deleted on a first match");
    assert.deepEqual(plex.journal.deletedItems, []);

    // The shelf exists from the very first run, so it can be reviewed in Plex
    // long before anything is removed.
    assert.equal(plex.journal.createdCollections.length, 1);
    assert.deepEqual(plex.journal.createdCollections[0].memberKeys.sort(), ["100", "101", "102"]);
    const shelf = [...plex.collections.values()][0];
    assert.ok(shelf.labels.includes("Tinkerbell:Cleanup"), `shelf labels were ${shelf.labels.join(", ")}`);

    // ── Run 2 ──
    await runGenerate();
    assert.deepEqual(
      listCandidates(RULE_ID).map((c) => c.streak),
      [2, 2, 2],
    );
    assert.deepEqual(arr.journal.deletes, [], "still nothing at streak 2");

    // ── Run 3 ──
    const log3 = await runGenerate();
    assert.equal(arr.journal.deletes.length, 3, "the streak reached the threshold");
    for (const d of arr.journal.deletes) {
      assert.match(d, /deleteFiles=true/, "the files go with the record");
      assert.match(d, /addImportExclusion=false/, "the rule did not ask for an exclusion");
    }

    // Removed through Radarr, not behind its back — a Plex-only delete would
    // leave the record and Radarr would re-download the same film tonight.
    assert.deepEqual(plex.journal.deletedItems, [], "Plex items are not deleted directly when viaArr is set");
    assert.equal(arr.movies.size, ITEMS.length - 3);

    // The ledger records what happened and keeps it as the audit trail.
    const actioned = listCandidates(RULE_ID).filter((c) => c.actionedAt != null);
    assert.equal(actioned.length, 3);
    assert.deepEqual([...new Set(actioned.map((c) => c.action))], ["delete"]);
    assert.match(log3.join("\n"), /\[cleanup\] delete: "The Descent"/);

    // And it says so where the user will see it.
    const types = db
      .select({ type: events.type })
      .from(events)
      .all()
      .map((e) => e.type);
    assert.ok(types.includes("cleanup.actioned"));
  });

  it("a run where an item stops matching resets it, so the third run removes nothing", async () => {
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });

    await runGenerate();
    await runGenerate();

    // Retag every horror film between runs — the library drifted, as a bad
    // metadata refresh would make it.
    for (const item of plex.items.values()) if (item.genre === "Horror") item.genre = "Thriller";

    await runGenerate();
    assert.deepEqual(listCandidates(RULE_ID), [], "the streak is gone, not merely paused");
    assert.deepEqual(arr.journal.deletes, []);

    // Put them back: the count starts from one again.
    for (const item of plex.items.values()) if (item.genre === "Thriller") item.genre = "Horror";
    await runGenerate();
    assert.deepEqual(
      listCandidates(RULE_ID).map((c) => c.streak),
      [1, 1, 1],
    );
    assert.deepEqual(arr.journal.deletes, []);
  });
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

describe("dry run, through the real job", () => {
  it("builds the shelf on every run and never touches anything", async () => {
    seedRule({ kind: "cleanup", mode: "delete", consecutiveRuns: 3, maxActionsPerRun: 25, viaArr: true, dryRun: true });

    let log: string[] = [];
    for (let i = 0; i < 4; i++) log = await runGenerate();

    assert.deepEqual(arr.journal.deletes, []);
    assert.deepEqual(plex.journal.deletedItems, []);
    assert.match(log.join("\n"), /DRY RUN — 3 item\(s\) are due for "delete"/);
    // Four runs, four shelves — each one replacing the last, since the rule's
    // old collections are cleared at the top of every run.
    assert.equal(plex.journal.createdCollections.length, 4);
    assert.equal(plex.collections.size, 1, "the previous run's shelf is cleaned up, not duplicated");
  });
});

// ─── The gates, through the real job ─────────────────────────────────────────

describe("gates, through the real job", () => {
  async function reachThreshold(): Promise<void> {
    await runGenerate();
    await runGenerate();
  }

  it("the global kill switch stops a rule that would otherwise fire", async () => {
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });
    await reachThreshold();
    setConfig("cleanup_enabled", false);

    const log = await runGenerate();
    assert.deepEqual(arr.journal.deletes, []);
    assert.match(log.join("\n"), /REFUSING.*disabled globally/s);
  });

  it("a stale library index stops it", async () => {
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });
    await reachThreshold();
    db.delete(jobRuns).run();
    db.insert(jobRuns)
      .values({
        id: "sync-old",
        jobId: "sync-media",
        status: "completed",
        startedAt: Date.now() - 5 * 86_400_000,
        finishedAt: Date.now() - 5 * 86_400_000,
      })
      .run();

    const log = await runGenerate();
    assert.deepEqual(arr.journal.deletes, []);
    assert.match(log.join("\n"), /REFUSING.*last synced 5 day\(s\) ago/s);
  });

  it("matching too much of the library stops it", async () => {
    // Every item is Horror now, so the rule matches 100% of the section.
    for (const item of plex.items.values()) item.genre = "Horror";
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });
    await reachThreshold();

    const log = await runGenerate();
    assert.deepEqual(arr.journal.deletes, []);
    assert.match(log.join("\n"), /REFUSING.*12 of 12 items \(100%\)/s);
    // Candidates are still tracked, so the queue page shows the problem.
    assert.equal(listCandidates(RULE_ID).length, 12);
  });

  it("the per-rule cap limits one run and leaves the rest queued", async () => {
    seedRule({ kind: "cleanup", mode: "delete", consecutiveRuns: 3, maxActionsPerRun: 1, viaArr: true, dryRun: false });
    await reachThreshold();

    await runGenerate();
    assert.equal(arr.journal.deletes.length, 1);
    assert.equal(listCandidates(RULE_ID).filter((c) => c.actionedAt == null).length, 2);
  });
});

// ─── The non-destructive modes ───────────────────────────────────────────────

describe("label mode, through the real job", () => {
  it("labels the matched items in Plex without removing anything", async () => {
    seedRule({
      kind: "cleanup",
      mode: "label",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: false,
      dryRun: false,
    });
    await runGenerate();
    await runGenerate();
    await runGenerate();

    assert.deepEqual(arr.journal.deletes, []);
    assert.deepEqual(plex.journal.deletedItems, []);

    // The label actually landed on the items, which is the thing a PUT to the
    // wrong endpoint would have silently failed to do.
    for (const key of ["100", "101", "102"]) {
      const item = plex.items.get(key)!;
      assert.ok(item.labels.includes("Tinkerbell:Cleanup"), `"${item.title}" was not labelled`);
    }
  });
});

describe("unmonitor mode, through the real job", () => {
  it("unmonitors in Radarr and leaves the files alone", async () => {
    seedRule({
      kind: "cleanup",
      mode: "unmonitor",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });
    await runGenerate();
    await runGenerate();
    await runGenerate();

    assert.equal(arr.journal.monitorWrites.length, 3);
    assert.deepEqual([...new Set(arr.journal.monitorWrites.map((w) => w.monitored))], [false]);
    assert.deepEqual(arr.journal.deletes, [], "unmonitor removes nothing");
    assert.equal(arr.movies.size, ITEMS.length);
  });
});

// ─── Back-compat ─────────────────────────────────────────────────────────────

describe("the two jobs own disjoint rules", () => {
  it("generate leaves a cleanup rule alone — no ledger rows, no shelf", async () => {
    // The split's whole point. If generate still picked these up, a cleanup
    // rule would advance its streak twice a night and reach its threshold in
    // half the runs the user asked for.
    seedRule({ kind: "cleanup", mode: "delete", consecutiveRuns: 3, dryRun: false });
    const log = await runCollections();

    assert.match(log.join("\n"), /No enabled collection rule\(s\) found/);
    assert.deepEqual(listCandidates(RULE_ID), [], "no streak was advanced");
    assert.deepEqual(plex.journal.createdCollections, [], "no queue shelf was built");
    assert.deepEqual(arr.journal.deletes, []);
  });

  it("cleanup leaves a collection rule alone", async () => {
    seedRule({ kind: "collection" });
    const log = await runGenerate();

    assert.match(log.join("\n"), /No enabled cleanup rule\(s\) found/);
    assert.deepEqual(plex.journal.createdCollections, [], "the collection job builds those, not this one");
  });
});

describe("a collection rule is untouched by any of this", () => {
  it("builds a collection and writes no ledger rows", async () => {
    seedRule({ kind: "collection" });
    const log = await runCollections();

    assert.doesNotMatch(log.join("\n"), /\[cleanup\]/);
    assert.deepEqual(listCandidates(RULE_ID), []);
    assert.equal(plex.journal.createdCollections.length, 1);
    // No cleanup label on an ordinary rule's collection.
    const collection = [...plex.collections.values()][0];
    assert.ok(!collection.labels.includes("Tinkerbell:Cleanup"));
  });
});

// ─── The overlapping-group trigger ───────────────────────────────────────────

describe("a grouped rule, where one item lands in several groups", () => {
  /**
   * The shape behind the worst bug this feature had. An `audio_languages` rule
   * buckets an item once per language, so a film with three audio tracks is
   * yielded three times in a single run. Counting each appearance took it from
   * nothing to a full streak in one pass, and it was deleted immediately.
   */
  it("counts one run as one run, however many groups the item appears in", async () => {
    await plex.close();
    plex = await startMockPlex({
      sections: SECTIONS,
      items: [
        {
          ratingKey: "300",
          title: "Polyglot",
          sectionId: "1",
          guids: ["tmdb://777"],
          labels: [],
          audioLanguages: ["English", "French", "German"],
        },
        {
          ratingKey: "301",
          title: "Monolingual",
          sectionId: "1",
          guids: ["tmdb://778"],
          labels: [],
          audioLanguages: ["English"],
        },
      ],
    });
    setConfig("global_plex_url", plex.origin);

    db.delete(rules).run();
    db.insert(rules)
      .values({
        id: RULE_ID,
        name: "Language sweep",
        type: "audio_languages",
        enabled: 1,
        createdAt: Date.now(),
        config: {
          action: { kind: "cleanup", mode: "label", consecutiveRuns: 3, maxActionsPerRun: 25, dryRun: false },
          pinToHomepage: false,
        },
      })
      .run();

    await runGenerate();

    const polyglot = listCandidates(RULE_ID).find((c) => c.ratingKey === "300");
    assert.ok(polyglot, "the three-language film should be tracked");
    assert.equal(polyglot.streak, 1, "three groups in one run is still one run");
    assert.equal(listCandidates(RULE_ID).find((c) => c.ratingKey === "301")?.streak, 1);
    // And nothing has been actioned, because one run is not three.
    assert.deepEqual(
      listCandidates(RULE_ID).filter((c) => c.actionedAt != null),
      [],
    );
  });
});

// ─── Mock coverage ───────────────────────────────────────────────────────────

describe("the mocks", () => {
  it("were not asked for anything they don't implement", async () => {
    // A gap in the mock makes every assertion above weaker, because an
    // unimplemented endpoint answers with a plausible empty container.
    seedRule({
      kind: "cleanup",
      mode: "delete",
      consecutiveRuns: 3,
      maxActionsPerRun: 25,
      viaArr: true,
      dryRun: false,
    });
    await runGenerate();
    await runGenerate();
    await runGenerate();

    assert.deepEqual(plex.journal.unhandled, []);
    assert.deepEqual(arr.journal.unhandled, []);
  });

  it("the rule's own collections are cleared by a server-side label filter", async () => {
    seedRule({ kind: "cleanup", mode: "collection_only", consecutiveRuns: 3, maxActionsPerRun: 25, dryRun: false });
    await runGenerate();
    await runGenerate();

    // The sweep that clears the previous run narrows the listing with `label=`
    // rather than fetching every collection's labels one at a time. If that
    // ever regresses to an unfiltered listing it stays correct — the client
    // re-checks — but silently costs a request per collection, which on a
    // large library was the whole point of the change.
    assert.ok(
      plex.journal.labelFilteredListings.some((l) => l.startsWith("Rule:")),
      `expected a label-filtered listing, saw ${JSON.stringify(plex.journal.labelFilteredListings)}`,
    );
  });
});
