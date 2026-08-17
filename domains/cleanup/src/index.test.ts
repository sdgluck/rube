/**
 * The streak is the only thing standing between a metadata blip and a deleted
 * file, so it is tested against a real migrated database rather than a fake:
 * the upsert-and-prune is expressed in SQL, and a fake would be testing the
 * fake.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import { eq } from "drizzle-orm";

setupTempDb("tinkerbell-cleanup-test-");

const {
  db,
  cleanupCandidates,
  cleanupKeepVotes,
  cleanupProtections,
  collectionItems,
  collections,
  jobs,
  jobRuns,
  rules,
} = await import("@tinkerbell/db");
const {
  recordMatches,
  dueForAction,
  markActioned,
  holdCandidate,
  listCandidates,
  queuedCandidates,
  dueSoonCount,
  addProtection,
  removeProtection,
  listProtections,
  protectedRatingKeys,
  recordKeepVote,
  removeKeepVote,
  keepVotesForUser,
  leavingSoon,
  setCandidateApproval,
  standingRefusal,
  willBeActioned,
} = await import("./index.ts");
const { setConfig, deleteConfig } = await import("@tinkerbell/core");

const RULE = "rule-1";
const OTHER = "rule-2";
const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

function seedRule(id: string, config: Record<string, unknown> = {}): void {
  db.insert(rules)
    .values({ id, name: `Rule ${id}`, type: "smart_filter", config, createdAt: T0 })
    .onConflictDoNothing()
    .run();
}

function match(ratingKey: string, title = `Film ${ratingKey}`) {
  return { ratingKey, sectionId: "1", title };
}

function streakOf(ruleId: string, ratingKey: string): number | undefined {
  return listCandidates(ruleId).find((c) => c.ratingKey === ratingKey)?.streak;
}

/**
 * An install where cleanup could actually remove something: the switch on, and
 * a recent successful library sync. Everything that warns a human about a
 * pending removal now checks both, so the fixtures have to state them — a
 * default install removes nothing, which is the whole point.
 */
function enableCleanup(at: number = Date.now()): void {
  setConfig("cleanup_enabled", true);
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .onConflictDoNothing()
    .run();
  db.insert(jobRuns)
    .values({
      id: `sync-${at}`,
      jobId: "sync-media",
      status: "completed",
      log: "",
      progress: 1,
      message: "",
      startedAt: at,
      finishedAt: at,
    })
    .onConflictDoNothing()
    .run();
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  deleteConfig("cleanup_enabled");
  db.delete(cleanupCandidates).run();
  db.delete(cleanupKeepVotes).run();
  db.delete(cleanupProtections).run();
  db.delete(collectionItems).run();
  db.delete(collections).run();
  db.delete(rules).run();
  seedRule(RULE, { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } });
  seedRule(OTHER, { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } });
  enableCleanup();
});

// ─── Streak accumulation ─────────────────────────────────────────────────────

describe("recordMatches", () => {
  test("a second run on the same day does not advance the streak", () => {
    // The threshold is presented as "three runs in a row", but a cleanup rule
    // can carry an `item-added` trigger that fires every fifteen minutes, a
    // cron of its own on top of the nightly batch, and a "Run now" button.
    // Counting runs meant three of them — 45 minutes, or three clicks — was
    // enough to delete a file.
    // Fixed zone and a midday base, so "the same day" is unambiguous wherever
    // this suite runs.
    setConfig("global_timezone", "UTC");
    const noon = Date.parse("2026-08-04T12:00:00Z");
    recordMatches(RULE, [match("100")], noon);
    recordMatches(RULE, [match("100")], noon + 60_000);
    recordMatches(RULE, [match("100")], noon + 6 * 60 * 60 * 1000);
    assert.equal(streakOf(RULE, "100"), 1);

    // The next day it moves.
    recordMatches(RULE, [match("100")], noon + DAY);
    assert.equal(streakOf(RULE, "100"), 2);
    deleteConfig("global_timezone");
  });

  test("a same-day run still keeps the row alive", () => {
    // Not advancing is not the same as not recording: the other half of the
    // streak is that an item which stops matching loses its row, so a run that
    // still matches has to refresh it.
    setConfig("global_timezone", "UTC");
    const noon = Date.parse("2026-08-04T12:00:00Z");
    recordMatches(RULE, [match("100")], noon);
    recordMatches(RULE, [match("100", "The Matrix")], noon + 60_000);
    const row = listCandidates(RULE).find((c) => c.ratingKey === "100");
    assert.equal(row?.streak, 1);
    assert.equal(row?.lastMatchedAt, noon + 60_000);
    assert.equal(row?.title, "The Matrix", "a retitled item still updates");
    deleteConfig("global_timezone");
  });

  test("an item matching three runs in a row reaches streak 3", () => {
    recordMatches(RULE, [match("100")], T0);
    assert.equal(streakOf(RULE, "100"), 1);
    recordMatches(RULE, [match("100")], T0 + DAY);
    assert.equal(streakOf(RULE, "100"), 2);
    recordMatches(RULE, [match("100")], T0 + 2 * DAY);
    assert.equal(streakOf(RULE, "100"), 3);
  });

  test("a run where it doesn't match deletes the row, and the next match starts at 1", () => {
    recordMatches(RULE, [match("100")], T0);
    recordMatches(RULE, [match("100")], T0 + DAY);
    assert.equal(streakOf(RULE, "100"), 2);

    // Stopped matching — the whole safety property. A filter that drifts in
    // and out must never accumulate.
    recordMatches(RULE, [], T0 + 2 * DAY);
    assert.equal(streakOf(RULE, "100"), undefined);

    recordMatches(RULE, [match("100")], T0 + 3 * DAY);
    assert.equal(streakOf(RULE, "100"), 1);
  });

  test("first and last matched timestamps track the streak, not the latest run", () => {
    recordMatches(RULE, [match("100")], T0);
    recordMatches(RULE, [match("100")], T0 + DAY);
    const row = listCandidates(RULE)[0];
    assert.equal(row.firstMatchedAt, T0);
    assert.equal(row.lastMatchedAt, T0 + DAY);
  });

  test("one rule's misses don't disturb another rule's streaks", () => {
    recordMatches(RULE, [match("100")], T0);
    recordMatches(OTHER, [match("100")], T0);
    recordMatches(RULE, [], T0 + DAY);

    assert.equal(streakOf(RULE, "100"), undefined);
    assert.equal(streakOf(OTHER, "100"), 1);
  });

  test("a retitled item shows its current name", () => {
    recordMatches(RULE, [match("100", "The Matrix")], T0);
    recordMatches(RULE, [match("100", "The Matrix (1999)")], T0 + DAY);
    assert.equal(listCandidates(RULE)[0].title, "The Matrix (1999)");
  });

  test("an actioned row is not resurrected by a later match", () => {
    // Plex can keep serving metadata briefly after a delete. Bumping the row
    // again would let one item be actioned twice.
    recordMatches(RULE, [match("100")], T0);
    markActioned(RULE, "100", "delete", T0 + DAY);
    recordMatches(RULE, [match("100")], T0 + 2 * DAY);

    const row = listCandidates(RULE)[0];
    assert.equal(row.streak, 1);
    assert.equal(row.actionedAt, T0 + DAY);
  });

  test("an actioned row survives a run it no longer matches — it is the audit trail", () => {
    recordMatches(RULE, [match("100")], T0);
    markActioned(RULE, "100", "delete", T0 + DAY);
    recordMatches(RULE, [], T0 + 2 * DAY);

    const rows = listCandidates(RULE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "delete");
  });

  test("an item matching twice in ONE run still only bumps the streak once", () => {
    // A grouped rule yields one group per director / language / decade, and an
    // item belongs to as many as it has credits or tracks. Counting each
    // appearance would let a film with three audio languages hit a streak of
    // three on its first run and be deleted immediately.
    recordMatches(RULE, [match("100", "Dune"), match("100", "Dune"), match("100", "Dune")], T0);
    assert.equal(streakOf(RULE, "100"), 1);
    assert.equal(listCandidates(RULE).length, 1);

    recordMatches(RULE, [match("100"), match("100")], T0 + DAY);
    assert.equal(streakOf(RULE, "100"), 2);
  });

  test("a duplicated item is still pruned when it stops matching", () => {
    recordMatches(RULE, [match("100"), match("100")], T0);
    recordMatches(RULE, [], T0 + DAY);
    assert.equal(streakOf(RULE, "100"), undefined);
  });

  test("handles a match set larger than SQLite's parameter cap", () => {
    const many = Array.from({ length: 950 }, (_, i) => match(`k${i}`));
    recordMatches(RULE, many, T0);
    assert.equal(listCandidates(RULE).length, 950);
    // And prunes them all again on a run that matches nothing.
    recordMatches(RULE, [], T0 + DAY);
    assert.equal(listCandidates(RULE).length, 0);
  });
});

// ─── dueForAction ────────────────────────────────────────────────────────────

describe("dueForAction", () => {
  test("excludes rows below the threshold", () => {
    recordMatches(RULE, [match("100")], T0);
    recordMatches(RULE, [match("100")], T0 + DAY);
    assert.deepEqual(dueForAction(RULE, 3, 10, T0 + DAY), []);

    recordMatches(RULE, [match("100")], T0 + 2 * DAY);
    assert.deepEqual(
      dueForAction(RULE, 3, 10, T0 + 2 * DAY).map((c) => c.ratingKey),
      ["100"],
    );
  });

  test("excludes already-actioned rows", () => {
    for (let i = 0; i < 3; i++) recordMatches(RULE, [match("100")], T0 + i * DAY);
    markActioned(RULE, "100", "delete", T0 + 3 * DAY);
    assert.deepEqual(dueForAction(RULE, 3, 10, T0 + 4 * DAY), []);
  });

  test("excludes held rows until the hold expires", () => {
    for (let i = 0; i < 3; i++) recordMatches(RULE, [match("100")], T0 + i * DAY);
    holdCandidate(RULE, "100", T0 + 30 * DAY);

    assert.deepEqual(dueForAction(RULE, 3, 10, T0 + 3 * DAY), []);
    // An expired hold stops applying on its own — no sweeper job needed.
    assert.equal(dueForAction(RULE, 3, 10, T0 + 31 * DAY).length, 1);
  });

  test("clearing a hold makes the item due again immediately", () => {
    for (let i = 0; i < 3; i++) recordMatches(RULE, [match("100")], T0 + i * DAY);
    holdCandidate(RULE, "100", T0 + 30 * DAY);
    holdCandidate(RULE, "100", null);
    assert.equal(dueForAction(RULE, 3, 10, T0 + 3 * DAY).length, 1);
  });

  test("respects the per-run limit, longest streak first", () => {
    // "100" has matched four runs, the others three.
    for (let i = 0; i < 4; i++) recordMatches(RULE, [match("100")], T0 + i * DAY);
    for (let i = 0; i < 3; i++) {
      recordMatches(RULE, [match("100"), match("200"), match("300")], T0 + (4 + i) * DAY);
    }

    const due = dueForAction(RULE, 3, 2, T0 + 7 * DAY);
    assert.equal(due.length, 2);
    assert.equal(due[0].ratingKey, "100", "the longest-running offender goes first");
  });

  test("is scoped to one rule", () => {
    for (let i = 0; i < 3; i++) recordMatches(OTHER, [match("100")], T0 + i * DAY);
    assert.deepEqual(dueForAction(RULE, 3, 10, T0 + 3 * DAY), []);
    assert.equal(dueForAction(OTHER, 3, 10, T0 + 3 * DAY).length, 1);
  });

  test("a freshly created rule can never have a full streak on its first run", () => {
    // First-run grace, which the streak logic gives for free — asserted so a
    // future "seed the streak on import" optimisation can't quietly remove it.
    recordMatches(RULE, [match("100"), match("200")], T0);
    assert.deepEqual(dueForAction(RULE, 3, 10, T0), []);
    assert.deepEqual(dueForAction(RULE, 2, 10, T0), []);
    // Even with consecutiveRuns at its minimum, one run is one run.
    assert.equal(dueForAction(RULE, 1, 10, T0).length, 2);
  });
});

// ─── Queue view ──────────────────────────────────────────────────────────────

describe("queuedCandidates", () => {
  test("reports runs remaining from the owning rule's config", () => {
    recordMatches(RULE, [match("100")], T0);
    const [row] = queuedCandidates();
    assert.equal(row.ruleName, "Rule rule-1");
    assert.equal(row.consecutiveRuns, 3);
    assert.equal(row.mode, "delete");
    assert.equal(row.runsRemaining, 2);
  });

  test("hides actioned rows unless asked for them", () => {
    recordMatches(RULE, [match("100")], T0);
    markActioned(RULE, "100", "delete", T0 + DAY);
    assert.equal(queuedCandidates().length, 0);
    assert.equal(queuedCandidates({ includeActioned: true }).length, 1);
  });

  test("falls back to a sane threshold for a rule with no action config", () => {
    seedRule("bare", {});
    recordMatches("bare", [match("100")], T0);
    const row = queuedCandidates().find((r) => r.ruleId === "bare")!;
    assert.equal(row.consecutiveRuns, 3);
    assert.equal(row.runsRemaining, 2);
  });

  test("deleting a rule takes its queue with it", () => {
    recordMatches(RULE, [match("100")], T0);
    db.delete(rules).run();
    assert.equal(queuedCandidates().length, 0);
    assert.equal(db.select().from(cleanupCandidates).all().length, 0);
  });

  test("hold state is decided server-side, not left to the viewer's clock", () => {
    // The page must not re-derive this from the browser's Date.now(): a skewed
    // client would then show a different queue from the one the engine acts on.
    recordMatches(RULE, [match("100")], T0);
    holdCandidate(RULE, "100", T0 + 30 * DAY);

    assert.equal(queuedCandidates({ now: T0 })[0].held, true);
    assert.equal(queuedCandidates({ now: T0 + 31 * DAY })[0].held, false, "an expired hold is no longer a hold");
  });

  test("the badge counts what is due now or on the next run", () => {
    recordMatches(RULE, [match("100")], T0); // streak 1, two runs away
    for (let i = 0; i < 2; i++) recordMatches(RULE, [match("100"), match("200")], T0 + (i + 1) * DAY);
    // "100" is at 3 (due), "200" at 2 (next run). Both count.
    assert.equal(dueSoonCount(), 2);

    holdCandidate(RULE, "100", Date.now() + 30 * DAY);
    assert.equal(dueSoonCount(), 1, "a held item is not about to happen");
  });
});

// ─── Protection ──────────────────────────────────────────────────────────────

/**
 * Protection is the last thing standing between a rule and a file it must
 * never touch, so the cases that matter are the ones where it could silently
 * fail open: a due item slipping through, a per-run limit filled entirely by
 * protected rows, and a collection rebuilt under a new rating key — which is
 * what Tinkerbell's own rules do to their collections nightly.
 */
function seedCollection(ratingKey: string, title: string, memberKeys: string[]): void {
  db.insert(collections)
    .values({ plexRatingKey: ratingKey, sectionId: "1", sectionTitle: "Movies", title, syncedAt: T0 })
    .onConflictDoNothing()
    .run();
  for (const itemRatingKey of memberKeys) {
    db.insert(collectionItems).values({ collectionRatingKey: ratingKey, itemRatingKey }).onConflictDoNothing().run();
  }
}

describe("protection", () => {
  test("a protected item is never due, however long its streak", () => {
    for (const t of [0, 1, 2, 3]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    assert.equal(dueForAction(RULE, 3, 10).length, 1);

    addProtection("item", "100", "Film 100");
    assert.deepEqual(dueForAction(RULE, 3, 10), []);
  });

  test("removing the protection lets it become due again", () => {
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    addProtection("item", "100", "Film 100");
    assert.equal(dueForAction(RULE, 3, 10).length, 0);

    removeProtection(listProtections()[0].id);
    assert.equal(dueForAction(RULE, 3, 10).length, 1);
  });

  test("the per-run limit still yields a full batch when protected rows lead", () => {
    // Without over-fetching, protecting the two longest streaks would return
    // an empty batch for a limit of 2 — the rule would silently stall rather
    // than move on to the items it is allowed to action.
    const keys = ["100", "101", "102", "103"];
    for (const t of [0, 1, 2])
      recordMatches(
        RULE,
        keys.map((k) => match(k)),
        T0 + t * DAY,
      );
    addProtection("item", "100", "Film 100");
    addProtection("item", "101", "Film 101");

    const due = dueForAction(RULE, 3, 2);
    assert.equal(due.length, 2);
    assert.deepEqual(due.map((d) => d.ratingKey).sort(), ["102", "103"]);
  });

  test("protecting a collection covers its members", () => {
    seedCollection("col-1", "Favourites", ["100", "200"]);
    addProtection("collection", "Favourites", "Favourites");
    const keys = protectedRatingKeys();
    assert.ok(keys.has("100"));
    assert.ok(keys.has("200"));
    assert.equal(keys.has("300"), false);
  });

  test("a collection protection survives the collection being recreated", () => {
    seedCollection("col-1", "Favourites", ["100"]);
    addProtection("collection", "Favourites", "Favourites");

    db.delete(collections).run();
    db.delete(collectionItems).run();
    seedCollection("col-2-new-key", "Favourites", ["100", "101"]);

    const keys = protectedRatingKeys();
    assert.ok(keys.has("100"));
    assert.ok(keys.has("101"));
  });

  test("collection titles match regardless of case and padding", () => {
    seedCollection("col-1", "Favourites", ["100"]);
    addProtection("collection", "  favourites  ", "Favourites");
    assert.ok(protectedRatingKeys().has("100"));
  });

  test("protecting the same thing twice is not an error", () => {
    addProtection("item", "100", "Film 100");
    addProtection("item", "100", "Film 100", "changed my mind about the note");
    assert.equal(listProtections().length, 1);
    assert.equal(listProtections()[0].note, "changed my mind about the note");
  });

  test("the queue marks protected rows so the page cannot contradict the engine", () => {
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    addProtection("item", "100", "Film 100");
    const row = queuedCandidates().find((c) => c.ratingKey === "100");
    assert.equal(row?.isProtected, true);
  });
});

// ─── Keep votes, and what the portal shows ───────────────────────────────────

/**
 * A vote is a signal, not a hold. The tests that matter are the ones that
 * would let it quietly become one — or let a shared user see, or influence,
 * something that isn't theirs.
 */
describe("keep votes", () => {
  test("a vote does not spare the item", () => {
    // This is the whole design. If a vote ever starts holding things back, a
    // shared user can silently overrule the server owner's rule.
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    recordKeepVote("100", 7, "sam");
    assert.equal(dueForAction(RULE, 3, 10).length, 1);
  });

  test("the queue shows who asked", () => {
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    recordKeepVote("100", 7, "sam");
    recordKeepVote("100", 8, "alex");
    const row = queuedCandidates().find((c) => c.ratingKey === "100");
    assert.deepEqual(row?.keepVotes.sort(), ["alex", "sam"]);
  });

  test("voting twice is one vote", () => {
    recordKeepVote("100", 7, "sam");
    recordKeepVote("100", 7, "sam");
    assert.equal(db.select().from(cleanupKeepVotes).all().length, 1);
  });

  test("a vote can be taken back", () => {
    recordKeepVote("100", 7, "sam");
    removeKeepVote("100", 7);
    assert.equal(keepVotesForUser(7).size, 0);
  });

  test("one person's votes are only their own", () => {
    recordKeepVote("100", 7, "sam");
    recordKeepVote("200", 8, "alex");
    assert.deepEqual([...keepVotesForUser(7)], ["100"]);
  });
});

describe("leavingSoon", () => {
  test("lists destructive items that are actually due", () => {
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    const items = leavingSoon();
    assert.equal(items.length, 1);
    assert.equal(items[0].ratingKey, "100");
  });

  test("leaves out anything already spared", () => {
    // Asking people to worry about something that has been held or protected
    // is how a warning list stops being read.
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("200")], T0 + t * DAY);
    holdCandidate(RULE, "100", T0 + 400 * DAY);
    addProtection("item", "200", "Film 200");
    assert.deepEqual(leavingSoon(50, T0 + 3 * DAY), []);
  });

  test("a non-destructive rule is not a warning", () => {
    seedRule("labeller", { action: { kind: "cleanup", mode: "label", consecutiveRuns: 1 } });
    recordMatches("labeller", [match("300")], T0);
    assert.deepEqual(leavingSoon(), []);
  });

  test("says nothing at all while cleanup is switched off", () => {
    // `cleanup_enabled` is off by default, and the engine refuses every
    // destructive action while it is. Telling a shared user their films are
    // leaving is then a promise the server has no way of keeping — and this was
    // the state of every fresh install.
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    deleteConfig("cleanup_enabled");
    assert.deepEqual(leavingSoon(), []);
    assert.equal(dueSoonCount(), 0);
  });

  test("says nothing while the library index is too stale to trust", () => {
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    db.delete(jobRuns).run();
    // The switch is on, but "nobody has watched this" can't be claimed off a
    // library nobody has synced.
    assert.deepEqual(leavingSoon(), []);
    assert.equal(dueSoonCount(), 0);
  });

  test("leaves out an item waiting on an approval nobody has given", () => {
    seedRule("gated", {
      action: { kind: "cleanup", mode: "delete", consecutiveRuns: 1, requireApproval: true },
    });
    recordMatches("gated", [match("400")], T0);

    assert.deepEqual(leavingSoon(), [], "an unapproved item is not going anywhere on its own");
    assert.equal(dueSoonCount(), 0);

    setCandidateApproval("gated", "400", true);
    assert.deepEqual(
      leavingSoon().map((i) => i.ratingKey),
      ["400"],
    );
    assert.equal(dueSoonCount(), 1);
  });

  test("leaves out the queue of a rule that has been switched off", () => {
    // A disabled rule never runs, so its queue is history. Warning about it is
    // warning about something that cannot happen.
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    db.update(rules).set({ enabled: 0 }).where(eq(rules.id, RULE)).run();
    assert.deepEqual(leavingSoon(), []);
    assert.equal(dueSoonCount(), 0);
  });
});

describe("willBeActioned", () => {
  test("is the one answer every surface uses", () => {
    // The regression this guards is four surfaces disagreeing: the queue page
    // mirrored the engine, the portal ignored the approval gate, the badge
    // ignored that and protection, and none of them asked whether cleanup was
    // switched on at all.
    for (const t of [0, 1, 2]) recordMatches(RULE, [match("100")], T0 + t * DAY);
    const [row] = queuedCandidates({ now: T0 + 3 * DAY });

    assert.equal(willBeActioned(row), true);
    assert.equal(willBeActioned({ ...row, isProtected: true }), false);
    assert.equal(willBeActioned({ ...row, held: true }), false);
    assert.equal(willBeActioned({ ...row, ruleEnabled: false }), false);
    assert.equal(willBeActioned({ ...row, requiresApproval: true, approved: false }), false);
    assert.equal(willBeActioned({ ...row, requiresApproval: true, approved: true }), true);
    assert.equal(willBeActioned(row, { refusal: "cleanup is off" }), false);
  });

  test("standingRefusal names the switch, and clears once it is on", () => {
    assert.equal(standingRefusal(), null);
    deleteConfig("cleanup_enabled");
    assert.match(standingRefusal() ?? "", /disabled globally/);
  });
});
