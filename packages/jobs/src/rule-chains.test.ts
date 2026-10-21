/**
 * Chaining has two halves that fail in opposite directions.
 *
 * Resolving too *little* — a chain that quietly matches nothing — looks exactly
 * like a chain that works, and only surfaces as a shelf built from yesterday's
 * pool. Resolving too *much* runs a rule twice in a row, which means deleting
 * and recreating its collections twice, or advancing its cleanup streak twice
 * on one night.
 *
 * The second half used to be guarded by a `seen` set threaded through the
 * recursion, which was per-dispatch and so missed the case of two paths wanting
 * the same rule seconds apart. The queue guards it instead, by folding a second
 * ask into the run already pending — a stronger claim, and the one tested here.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken } from "@rube/db";
import { ruleRuns, rules } from "@rube/db";
import { createRuleQueue } from "./rule-queue.ts";
import { RuleRunsToken } from "@rube/domain.rule-runs";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { rulesChainedAfter, enqueueRuleWork } = createRuleQueue(services);
const { getQueuedRuleRuns } = c.resolve(RuleRunsToken);

const T0 = 1_700_000_000_000;

function seedRule(id: string, config: Record<string, unknown> = {}, enabled = 1): void {
  db.insert(rules)
    .values({ id, name: id, type: "smart_filter", config, enabled, createdAt: T0 })
    .onConflictDoNothing()
    .run();
}

const names = (ruleId: string, now?: Date) =>
  rulesChainedAfter(ruleId, now)
    .map((r) => r.id)
    .sort();

beforeEach(() => {
  db.delete(ruleRuns).run();
  db.delete(rules).run();
});

describe("rulesChainedAfter", () => {
  test("finds every rule that names it", () => {
    seedRule("a");
    seedRule("first", { schedule: { afterRules: ["a"] } });
    seedRule("second", { schedule: { afterRules: ["a", "b"] } });
    assert.deepEqual(names("a"), ["first", "second"]);
  });

  test("a rule chained behind nothing that ran is left alone", () => {
    seedRule("a");
    seedRule("unrelated", { schedule: { afterRules: ["something-else"] } });
    assert.deepEqual(names("a"), []);
  });

  test("the host rule cannot chain to itself", () => {
    // `afterRules` naming the rule that just ran is a one-step cycle.
    seedRule("a", { schedule: { afterRules: ["a"] } });
    assert.deepEqual(names("a"), []);
  });

  test("a disabled rule is not woken by its upstream", () => {
    seedRule("a");
    seedRule("downstream", { schedule: { afterRules: ["a"] } }, 0);
    assert.deepEqual(names("a"), []);
  });

  test("an out-of-season rule stays out of season however it was started", () => {
    seedRule("a");
    seedRule("halloween", { schedule: { afterRules: ["a"], activeFrom: "10-01", activeTo: "11-05" } });
    assert.deepEqual(names("a", new Date("2026-06-15T12:00:00Z")), []);
    assert.deepEqual(names("a", new Date("2026-10-31T12:00:00Z")), ["halloween"]);
  });

  test("a config too broken to validate still yields its chain", () => {
    // Read defensively rather than through `ruleConfigSchema`: losing an
    // ordering constraint to an unrelated validation failure is silent, and
    // produces a wrong shelf rather than an error.
    seedRule("a");
    seedRule("downstream", { schedule: { afterRules: ["a"] }, limit: "not a number" });
    assert.deepEqual(names("a"), ["downstream"]);
  });
});

describe("enqueueRuleWork", () => {
  test("folds a second ask into the run already pending", () => {
    // Two rules due at 03:00 with a third chained behind both, or a rule on a
    // cron that also listens for item-added. One run, not two.
    seedRule("downstream");
    assert.ok(enqueueRuleWork("downstream", "chain"));
    assert.equal(enqueueRuleWork("downstream", "chain"), null);
    assert.equal(enqueueRuleWork("downstream", "item-added"), null);
    assert.equal(getQueuedRuleRuns().length, 1);
  });

  test("records why the run was asked for", () => {
    seedRule("nightly");
    enqueueRuleWork("nightly", "cron");
    assert.equal(getQueuedRuleRuns()[0]?.trigger, "cron");
  });

  test("a rule that finished is askable again", () => {
    seedRule("hourly");
    const runId = enqueueRuleWork("hourly", "cron");
    assert.ok(runId);
    db.delete(ruleRuns).run();
    assert.ok(enqueueRuleWork("hourly", "cron"));
  });
});
