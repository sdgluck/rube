/**
 * Leaving Soon end to end: a real cleanup ledger, a mock Plex over HTTP, and a
 * pinned clock.
 *
 * What's protected: the row holds exactly what the cleanup engine would act
 * on — not something held, or a rule that is off, or anything at all while
 * cleanup is switched off — and it follows the queue, emptying away when
 * nothing is leaving.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { cleanupCandidates, DbToken, jobRuns, jobs, rules } from "@tinkerbell/db";
import { ClockToken } from "@tinkerbell/ports";
import { eq } from "drizzle-orm";
import { startMockPlex, type MockItem, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createLeavingSoonCommand, LEAVING_LABEL } from "./index.ts";
import { createLeavingRemoveCommand } from "../leaving-remove.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T12:00:00Z");

const c = createTestContainer({ now: T0 });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { recordMatches, holdCandidate } = services.cleanup;
const { run } = createLeavingSoonCommand(services, { now: c.resolve(ClockToken) });
const { run: remove } = createLeavingRemoveCommand(services);

const RULE = "cleanup-rule";
const film = (key: string, title: string): MockItem => ({
  ratingKey: key,
  title,
  sectionId: "1",
  guids: [],
  labels: [],
});

let plex: MockPlex;

function testContext(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

const rows = () => [...plex.collections.values()].filter((r) => r.labels.includes(LEAVING_LABEL));

/**
 * Daily cleanup runs ending at T0, each matching every key whose streak (in
 * days) reaches back that far. One run is the whole match set: a key a run
 * doesn't match loses its row, so they can't be seeded one key at a time.
 */
function matched(streaks: Record<string, number>): void {
  const longest = Math.max(...Object.values(streaks));
  for (let d = longest - 1; d >= 0; d--) {
    const keys = Object.keys(streaks).filter((k) => streaks[k] > d);
    recordMatches(
      RULE,
      keys.map((k) => ({ ratingKey: k, sectionId: "1", title: plex.items.get(k)!.title })),
      T0 - d * DAY,
    );
  }
}

before(async () => {
  plex = await startMockPlex({
    sections: [
      { key: "1", title: "Films", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ],
    items: [film("100", "Old Film"), film("101", "Older Film"), film("102", "Newer Film")],
  });
});
after(async () => plex?.close());

beforeEach(() => {
  c.setNow(T0);
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("cleanup_enabled", true);
  for (const table of [cleanupCandidates, jobRuns, jobs, rules]) db.delete(table).run();
  db.insert(rules)
    .values({
      id: RULE,
      name: "Unwatched for a year",
      type: "smart_filter",
      config: { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 5 } },
      createdAt: T0,
    })
    .run();
  // A fresh library sync: cleanup refuses to act on a stale index, and so
  // does this row.
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .run();
  db.insert(jobRuns)
    .values({
      id: "s",
      jobId: "sync-media",
      status: "completed",
      log: "",
      progress: 1,
      message: "",
      startedAt: T0,
      finishedAt: T0,
    })
    .run();
});

describe("leaving-soon", () => {
  it("builds one shared row of what cleanup will remove, soonest first", async () => {
    matched({ "100": 4, "101": 4, "102": 1 }); // one run left; one run left; four runs left
    const { ctx, log } = testContext();
    await run(ctx, {});

    const [row, ...more] = rows();
    assert.equal(more.length, 0, "no row in TV, where nothing is leaving");
    assert.equal(displayTitle(row.title), "Leaving Soon");
    assert.notEqual(row.title, "Leaving Soon", "carries its own mark, so a hand-made one isn't pooled with it");
    assert.deepEqual(row.labels, ["Tinkerbell", LEAVING_LABEL]);
    assert.deepEqual(row.memberKeys, ["100", "101", "102"]);
    assert.equal(row.summary, "Cleanup removes these within 5 days. Watch them before they go.");
    assert.deepEqual(plex.journal.pinHomes, [{ ratingKey: row.ratingKey, own: true, shared: true, recommended: true }]);
    assert.match(log.join("\n"), /Old Film \(1 more run\(s\)\)/);
  });

  it("only looks as far ahead as it's told", async () => {
    matched({ "100": 4, "102": 1 });
    await run(testContext().ctx, { withinRuns: 1 });
    assert.deepEqual(rows()[0].memberKeys, ["100"]);
  });

  it("leaves out what cleanup won't act on: held items, and rules switched off", async () => {
    matched({ "100": 4, "101": 4 });
    holdCandidate(RULE, "100", T0 + 30 * DAY);
    await run(testContext().ctx, {});
    assert.deepEqual(rows()[0].memberKeys, ["101"]);

    db.update(rules).set({ enabled: 0 }).where(eq(rules.id, RULE)).run();
    await run(testContext().ctx, {});
    assert.equal(rows().length, 0);
  });

  it("takes the row down while cleanup is switched off", async () => {
    matched({ "100": 4 });
    await run(testContext().ctx, {});
    assert.equal(rows().length, 1);

    setConfig("cleanup_enabled", false);
    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.equal(rows().length, 0);
    assert.match(log.join("\n"), /Cleanup won't remove anything right now/);
  });

  it("follows the queue in place, and goes when the queue empties", async () => {
    matched({ "100": 4, "101": 4 });
    await run(testContext().ctx, {});
    const [first] = rows();

    // 101 was removed overnight: its ledger row is actioned, and it's gone from Plex.
    db.update(cleanupCandidates)
      .set({ actionedAt: T0 + DAY })
      .where(eq(cleanupCandidates.ratingKey, "101"))
      .run();
    c.setNow(T0 + DAY);
    await run(testContext().ctx, {});
    const [second] = rows();
    assert.equal(second.ratingKey, first.ratingKey, "edited in place");
    assert.deepEqual(second.memberKeys, ["100"]);
    assert.equal(plex.journal.pinned.length, 1, "pinned once, on creation");

    db.delete(cleanupCandidates).run();
    await run(testContext().ctx, {});
    assert.equal(rows().length, 0);
  });

  it("is torn down by its remove job, which leaves other rows alone", async () => {
    matched({ "100": 4 });
    await run(testContext().ctx, {});
    plex.collections.set("9999", {
      ratingKey: "9999",
      title: "Other",
      sectionId: "1",
      labels: ["SeasonCollections"],
      memberKeys: [],
    });
    await remove(testContext().ctx);
    assert.deepEqual(
      [...plex.collections.values()].map((r) => r.ratingKey),
      ["9999"],
    );
  });
});
