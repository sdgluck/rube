/**
 * Table-driven tests for the local watch-state predicates.
 *
 * These are the whole feature's correctness surface: a wrong answer here is a
 * collection with the wrong films in it, and with `media-lifecycle` wired up,
 * a deletion. Nothing here touches the DB — `evaluateLocal` is pure and the
 * rows are handed in.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SmartFilterLeaf, SmartFilterOp } from "@tinkerbell/plex-smart-filter";
import { evaluateLocal, resolveDateValue, type LocalEvalContext } from "./evaluate.ts";
import type { WatchStateRow } from "./store.ts";

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const DAY = 86_400_000;

function ctx(over: Partial<LocalEvalContext> = {}): LocalEvalContext {
  return { userIds: [1, 2], now: NOW, completionThreshold: 0.85, ...over };
}

function row(over: Partial<WatchStateRow> = {}): WatchStateRow {
  return {
    ratingKey: "100",
    userId: 1,
    plays: 1,
    completedPlays: 1,
    firstPlayedAt: NOW - 10 * DAY,
    lastPlayedAt: NOW - 10 * DAY,
    totalWatchedMs: 7_200_000,
    maxCompletionPct: 1,
    ...over,
  };
}

/** Started but gave up at `pct`. */
function abandoned(userId: number, pct: number): WatchStateRow {
  return row({ userId, plays: 1, completedPlays: 0, maxCompletionPct: pct });
}

function leaf(field: string, op: SmartFilterOp = "=", value = "1"): SmartFilterLeaf {
  return { kind: "leaf", field, op, value };
}

// ─── tb.watchedByAll ─────────────────────────────────────────────────────────

describe("tb.watchedByAll", () => {
  test("true only when every user in scope has a completed play", () => {
    const rows = [row({ userId: 1 }), row({ userId: 2 })];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), rows, ctx()), true);
  });

  test("false when one user in scope has not finished it", () => {
    const rows = [row({ userId: 1 }), abandoned(2, 0.3)];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), rows, ctx()), false);
  });

  test("false when a user in scope has no row at all", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), [row({ userId: 1 })], ctx()), false);
  });

  test("an EMPTY USER SET is false, never true", () => {
    // The vacuous reading — "everyone has watched it because there is nobody"
    // — would mark an entire library as watched by everyone on a fresh install.
    // With a cleanup rule attached that deletes the library.
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), [], ctx({ userIds: [] })), false);
    const everyone = [row({ userId: 1 }), row({ userId: 2 })];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), everyone, ctx({ userIds: [] })), false);
  });

  test("an item with no watch_state row fails it", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), undefined, ctx()), false);
  });

  test("users outside the scope don't count towards everyone", () => {
    const rows = [row({ userId: 1 }), row({ userId: 99 })];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), rows, ctx({ userIds: [1, 2] })), false);
  });

  test("extra users outside the scope don't block it either", () => {
    const rows = [row({ userId: 1 }), row({ userId: 2 }), abandoned(99, 0.1)];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll"), rows, ctx({ userIds: [1, 2] })), true);
  });

  test("= 0 inverts it", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByAll", "=", "0"), [row({ userId: 1 })], ctx()), true);
  });

  test("!= 1 inverts it as well", () => {
    const rows = [row({ userId: 1 }), row({ userId: 2 })];
    assert.equal(evaluateLocal(leaf("tb.watchedByAll", "!=", "1"), rows, ctx()), false);
  });
});

// ─── tb.watchedByNobody ──────────────────────────────────────────────────────

describe("tb.watchedByNobody", () => {
  test("an item with no watch_state row satisfies it", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByNobody"), undefined, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.watchedByNobody"), [], ctx()), true);
  });

  test("started and abandoned still counts as nobody having watched it", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByNobody"), [abandoned(1, 0.4)], ctx()), true);
  });

  test("one completed play by anyone is enough to fail it", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedByNobody"), [row({ userId: 1 })], ctx()), false);
  });

  test("a play by a user outside the scope still fails it", () => {
    // Not the complement of watchedByAll: an item the excluded owner finished
    // has been watched by somebody, whatever "everyone" is defined as.
    const rows = [row({ userId: 99 })];
    assert.equal(evaluateLocal(leaf("tb.watchedByNobody"), rows, ctx({ userIds: [1, 2] })), false);
  });
});

// ─── tb.watchedBy ────────────────────────────────────────────────────────────

describe("tb.watchedBy", () => {
  test("matches a completed play by that user", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", "2"), [row({ userId: 2 })], ctx()), true);
  });

  test("does NOT match started-and-abandoned", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", "2"), [abandoned(2, 0.9)], ctx()), false);
  });

  test("does not match a different user's completed play", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", "2"), [row({ userId: 3 })], ctx()), false);
  });

  test("is unaffected by the resolved user set", () => {
    const rows = [row({ userId: 99 })];
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", "99"), rows, ctx({ userIds: [1] })), true);
  });

  test("!= is 'has not watched'", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "!=", "2"), [row({ userId: 2 })], ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "!=", "2"), [row({ userId: 3 })], ctx()), true);
  });

  test("an unparseable user id matches nothing rather than everything", () => {
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", ""), [row({ userId: 2 })], ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.watchedBy", "=", "Sam"), [row({ userId: 2 })], ctx()), false);
  });
});

// ─── tb.playCount ────────────────────────────────────────────────────────────

describe("tb.playCount", () => {
  test("sums completed plays across users", () => {
    const rows = [row({ userId: 1, completedPlays: 2 }), row({ userId: 2, completedPlays: 3 })];
    assert.equal(evaluateLocal(leaf("tb.playCount", "=", "5"), rows, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.playCount", ">=", "5"), rows, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.playCount", ">", "5"), rows, ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.playCount", "<", "6"), rows, ctx()), true);
  });

  test("abandoned plays don't count", () => {
    const rows = [row({ userId: 1, plays: 9, completedPlays: 1 })];
    assert.equal(evaluateLocal(leaf("tb.playCount", "=", "1"), rows, ctx()), true);
  });

  test("no rows is zero, not undefined", () => {
    assert.equal(evaluateLocal(leaf("tb.playCount", "=", "0"), undefined, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.playCount", ">=", "1"), undefined, ctx()), false);
  });

  test("a non-numeric value matches nothing", () => {
    assert.equal(evaluateLocal(leaf("tb.playCount", ">=", "lots"), [row()], ctx()), false);
  });
});

// ─── tb.lastPlayedAt ─────────────────────────────────────────────────────────

describe("tb.lastPlayedAt", () => {
  test("uses the most recent play across users", () => {
    const rows = [row({ userId: 1, lastPlayedAt: NOW - 100 * DAY }), row({ userId: 2, lastPlayedAt: NOW - 3 * DAY })];
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", ">=", "-7d"), rows, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", "<=", "-7d"), rows, ctx()), false);
  });

  test("an item played only long ago fails a recency filter", () => {
    const rows = [row({ lastPlayedAt: NOW - 400 * DAY })];
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", ">=", "-30d"), rows, ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", "<=", "-1y"), rows, ctx()), true);
  });

  test("never played matches no date comparison, including !=", () => {
    // There is no last-played date to compare. `!=` returning true would sweep
    // the entire unplayed library into a "not played recently" rule.
    for (const op of ["=", "!=", ">=", "<=", ">", "<"] as SmartFilterOp[]) {
      assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", op, "-30d"), undefined, ctx()), false, `op ${op}`);
    }
  });

  test("a row whose lastPlayedAt is null is treated as never played", () => {
    const rows = [row({ lastPlayedAt: null })];
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", ">=", "-30d"), rows, ctx()), false);
  });

  test("absolute ISO dates work alongside relative offsets", () => {
    const rows = [row({ lastPlayedAt: new Date("2023-06-15T12:00:00Z").getTime() })];
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", ">=", "2023-01-01"), rows, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", "<", "2023-01-01"), rows, ctx()), false);
  });

  test("an unparseable date matches nothing", () => {
    assert.equal(evaluateLocal(leaf("tb.lastPlayedAt", ">=", "last tuesday"), [row()], ctx()), false);
  });
});

describe("resolveDateValue", () => {
  test("relative offsets", () => {
    assert.equal(resolveDateValue("-7d", NOW), NOW - 7 * DAY);
    assert.equal(resolveDateValue("-2w", NOW), NOW - 14 * DAY);
    assert.equal(resolveDateValue("-1y", NOW), new Date(NOW).setFullYear(new Date(NOW).getFullYear() - 1));
  });

  test("absolute forms", () => {
    assert.equal(resolveDateValue("2024-01-31", NOW), new Date("2024-01-31T00:00:00").getTime());
    assert.equal(resolveDateValue("1700000000", NOW), 1_700_000_000_000);
    assert.equal(resolveDateValue("2020", NOW), new Date("2020-01-01T00:00:00").getTime());
  });

  test("anything else is null", () => {
    assert.equal(resolveDateValue("", NOW), null);
    assert.equal(resolveDateValue("soon", NOW), null);
    assert.equal(resolveDateValue("+7d", NOW), null);
  });
});

// ─── tb.abandonedPct ─────────────────────────────────────────────────────────

describe("tb.abandonedPct", () => {
  test("uses the MAX completion across users, not the mean", () => {
    // Mean would be 45% and match "below 50"; max is 80% and must not.
    const rows = [abandoned(1, 0.1), abandoned(2, 0.8)];
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "50"), rows, ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "90"), rows, ctx()), true);
  });

  test("everyone bouncing off early matches", () => {
    const rows = [abandoned(1, 0.05), abandoned(2, 0.12)];
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "20"), rows, ctx()), true);
  });

  test("an item NOBODY started never matches", () => {
    // 0% is not "abandoned at 0%" — it is "never begun". Without this the
    // shelf is the entire unwatched library.
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "20"), undefined, ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "20"), [], ctx()), false);
  });

  test("a completed play floors the figure at the threshold, even with no recorded offset", () => {
    // Rows written before max_completion_pct existed, and backfilled Plex
    // history, carry a completed play and a 0 offset. Reading those as 0%
    // would file finished films under "everyone bounced off this".
    const legacy = [row({ userId: 1, completedPlays: 1, maxCompletionPct: 0 })];
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "20"), legacy, ctx()), false);
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", ">=", "85"), legacy, ctx()), true);
  });

  test("the comparison is in percent, not a 0–1 fraction", () => {
    const rows = [abandoned(1, 0.15)];
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "20"), rows, ctx()), true);
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "0.2"), rows, ctx()), false);
  });

  test("a non-numeric value matches nothing", () => {
    assert.equal(evaluateLocal(leaf("tb.abandonedPct", "<", "a fifth"), [abandoned(1, 0.1)], ctx()), false);
  });
});

// ─── Unknown fields ──────────────────────────────────────────────────────────

test("an unknown tb. field matches nothing rather than everything", () => {
  // Rejected at save time; if one reaches here the rule bypassed validation,
  // and a filter that may feed a deletion should collapse to empty, not to all.
  assert.equal(evaluateLocal(leaf("tb.notAThing"), [row()], ctx()), false);
  assert.equal(evaluateLocal(leaf("tb.notAThing", "!=", "1"), [row()], ctx()), false);
});
