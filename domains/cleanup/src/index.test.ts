/**
 * The streak is the only thing standing between a metadata blip and a deleted
 * file, so it is tested against a real migrated database rather than a fake:
 * the upsert-and-prune is expressed in SQL, and a fake would be testing the
 * fake.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-cleanup-test-");

const { db, cleanupCandidates, rules } = await import("@tinkerbell/db");
const { recordMatches, dueForAction, markActioned, holdCandidate, listCandidates, queuedCandidates, dueSoonCount } =
  await import("./index.ts");

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

beforeEach(() => {
  db.delete(cleanupCandidates).run();
  db.delete(rules).run();
  seedRule(RULE, { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } });
  seedRule(OTHER, { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } });
});

// ─── Streak accumulation ─────────────────────────────────────────────────────

describe("recordMatches", () => {
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

  test("the badge counts what is due now or on the next run", () => {
    recordMatches(RULE, [match("100")], T0); // streak 1, two runs away
    for (let i = 0; i < 2; i++) recordMatches(RULE, [match("100"), match("200")], T0 + (i + 1) * DAY);
    // "100" is at 3 (due), "200" at 2 (next run). Both count.
    assert.equal(dueSoonCount(), 2);

    holdCandidate(RULE, "100", Date.now() + 30 * DAY);
    assert.equal(dueSoonCount(), 1, "a held item is not about to happen");
  });
});
