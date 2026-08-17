/**
 * Chaining's only guard is the `seen` set, and its scope is the whole feature.
 *
 * Per dispatch, a rule reachable two ways round runs once — that has always been
 * true of the trigger path, which threads one set through the recursion. The
 * per-rule scheduler didn't: it started a fresh set for every due rule, so a
 * rule chained behind two rules that were both due at 03:00 ran twice, back to
 * back. Twice means deleting and recreating its collections twice, or advancing
 * its cleanup streak twice on one night.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";

setupTempDb("tinkerbell-rule-chains-test-");

const { db, rules } = await import("@tinkerbell/db");
const { noopCheckpoint } = await import("@tinkerbell/core");
const { runRulesChainedAfter } = await import("./rule-triggers.ts");

const T0 = 1_700_000_000_000;

function seedRule(id: string, config: Record<string, unknown> = {}): void {
  db.insert(rules)
    .values({ id, name: id, type: "smart_filter", config, enabled: 1, createdAt: T0 })
    .onConflictDoNothing()
    .run();
}

function testContext(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  const ctx = {
    log: (...parts: unknown[]) => log.push(parts.join(" ")),
    progress: () => {},
    signal: new AbortController().signal,
    checkpoint: noopCheckpoint,
    runId: null,
  } as unknown as JobContext;
  return { ctx, log };
}

beforeEach(() => {
  db.delete(rules).run();
});

describe("runRulesChainedAfter", () => {
  test("skips a chained rule the caller has already run this tick", async () => {
    // What the scheduler now passes: one set for the whole tick, carrying the
    // rules it has already run. "downstream" is chained behind both "a" and "b",
    // so the second call must find nothing left to do.
    seedRule("a");
    seedRule("b");
    seedRule("downstream", { schedule: { afterRules: ["a", "b"] } });

    const { ctx } = testContext();
    const seen = new Set<string>(["downstream"]);
    assert.equal(await runRulesChainedAfter(ctx, "a", seen), null);
    assert.equal(await runRulesChainedAfter(ctx, "b", seen), null);
  });

  test("a rule chained behind nothing that ran is left alone", async () => {
    seedRule("a");
    seedRule("unrelated", { schedule: { afterRules: ["something-else"] } });
    const { ctx } = testContext();
    assert.equal(await runRulesChainedAfter(ctx, "a", new Set()), null);
  });

  test("the host rule cannot chain to itself", async () => {
    // `afterRules` naming the rule that just ran is a one-step cycle; the set
    // the caller hands over already contains it, and so does the default.
    seedRule("a", { schedule: { afterRules: ["a"] } });
    const { ctx } = testContext();
    assert.equal(await runRulesChainedAfter(ctx, "a"), null);
  });
});
