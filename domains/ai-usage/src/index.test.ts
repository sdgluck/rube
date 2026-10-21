/**
 * The budget is the part that can do damage, so most of this is about it: it
 * must refuse metered work once spent, never refuse a diagnostic, and reset on
 * the 1st in the configured zone rather than UTC's.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { ConfigStoreToken, DAY_MS } from "@rube/core";
import type { LlmClient, LlmResponse } from "@rube/llm";

import { AiUsageToken, LlmBudgetExceededError } from "./index.ts";

function fakeClient(tokens: { in: number; out: number }, fail = false): LlmClient & { calls: number } {
  const client = {
    provider: "anthropic" as const,
    model: "test-model",
    calls: 0,
    async complete(): Promise<LlmResponse> {
      client.calls++;
      if (fail) throw new Error("upstream 529");
      return { text: "ok", tokensIn: tokens.in, tokensOut: tokens.out, model: "test-model", provider: "anthropic" };
    },
    ping(): Promise<LlmResponse> {
      return client.complete();
    },
  };
  return client;
}

const MID_MARCH = Date.parse("2027-03-15T12:00:00Z");

function setup(now = MID_MARCH) {
  const c = createTestContainer({ now });
  after(() => c.dispose());
  const config = c.resolve(ConfigStoreToken);
  config.setConfig("global_timezone", "UTC");
  return { c, config, usage: c.resolve(AiUsageToken) };
}

describe("ai usage", () => {
  test("records successes and failures, attributed", async () => {
    const { usage } = setup();
    await usage.track(fakeClient({ in: 100, out: 20 }), { feature: "rule", ruleId: "r1" }).complete({ prompt: "x" });
    await assert.rejects(
      usage.track(fakeClient({ in: 0, out: 0 }, true), { feature: "rule", ruleId: "r1" }).complete({ prompt: "x" }),
      /upstream 529/,
    );

    const summary = usage.usageSummary();
    assert.deepEqual(summary.day, { calls: 2, failed: 1, tokensIn: 100, tokensOut: 20 });
    assert.equal(summary.byFeature[0].feature, "rule");
    assert.equal(summary.byRule[0].ruleId, "r1");
    // A deleted (here, never-created) rule still shows, without a name.
    assert.equal(summary.byRule[0].ruleName, null);
    assert.equal(summary.byModel[0].model, "test-model");
  });

  test("no budget means no cap, and 0 means no budget", async () => {
    const { usage, config } = setup();
    config.setConfig("ai_monthly_token_budget", 0);
    await usage.track(fakeClient({ in: 5_000, out: 5_000 }), { feature: "rule" }).complete({ prompt: "x" });
    assert.equal(usage.budgetStatus().budget, null);
    assert.equal(usage.budgetExceededReason(), null);
  });

  test("a spent budget refuses metered calls without making them", async () => {
    const { usage, config } = setup();
    config.setConfig("ai_monthly_token_budget", 1_000);
    // One call may overshoot: the check is before the request.
    await usage.track(fakeClient({ in: 900, out: 300 }), { feature: "rule" }).complete({ prompt: "x" });
    assert.match(usage.budgetExceededReason() ?? "", /1,200 of 1,000/);

    const next = fakeClient({ in: 1, out: 1 });
    await assert.rejects(
      usage.track(next, { feature: "because-you-watched" }).complete({ prompt: "x" }),
      LlmBudgetExceededError,
    );
    assert.equal(next.calls, 0);
    // The refusal is not a usage row.
    assert.equal(usage.usageSummary().day.calls, 1);
  });

  test("diagnostics still run over budget, so the provider can be debugged", async () => {
    const { usage, config } = setup();
    config.setConfig("ai_monthly_token_budget", 10);
    await usage.track(fakeClient({ in: 50, out: 0 }), { feature: "rule" }).complete({ prompt: "x" });
    for (const feature of ["health-check", "test-connection"] as const) {
      const client = fakeClient({ in: 1, out: 1 });
      await usage.track(client, { feature }).ping();
      assert.equal(client.calls, 1);
    }
  });

  test("the budget resets on the 1st in the configured zone", async () => {
    // 23:00 on 31 March in UTC is already 1 April in Berlin.
    const { c, usage, config } = setup(Date.parse("2027-03-31T20:00:00Z"));
    config.setConfig("ai_monthly_token_budget", 100);
    await usage.track(fakeClient({ in: 100, out: 0 }), { feature: "rule" }).complete({ prompt: "x" });
    assert.ok(usage.budgetStatus().exceeded);

    c.setNow(Date.parse("2027-03-31T23:00:00Z"));
    assert.ok(usage.budgetStatus().exceeded, "still March in UTC");
    config.setConfig("global_timezone", "Europe/Berlin");
    assert.equal(usage.budgetStatus().used, 0, "already April in Berlin");
  });

  test("prunes past retention only", async () => {
    const { c, usage } = setup();
    await usage.track(fakeClient({ in: 1, out: 1 }), { feature: "rule" }).complete({ prompt: "x" });
    c.advance(399 * DAY_MS);
    assert.equal(usage.pruneLlmUsage(), 0);
    c.advance(2 * DAY_MS);
    assert.equal(usage.pruneLlmUsage(), 1);
  });
});
