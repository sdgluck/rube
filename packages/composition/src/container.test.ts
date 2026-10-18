/**
 * The test this whole overhaul exists for.
 *
 * The bug it replaces is documented at the top of the old
 * `packages/jobs/src/hooks.ts`: four cross-domain edges were module-level
 * `let`s in `@tinkerbell/core` defaulting to no-ops, assigned by a
 * `registerCoreHooks()` call that each entrypoint had to remember to make. The
 * Sidequest worker thread has its own module graph and never made it, so health
 * reports, notification traces, provider rescans and per-user collection counts
 * silently did nothing for every job — no error, no log line, for as long as
 * jobs had existed.
 *
 * Resolving every registered token is what makes that class of mistake loud. A
 * dependency nobody provides is not a no-op here; it is a failing test.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { ScopeRequiredError } from "@tinkerbell/container";
import { createTestContainer } from "./test-support.ts";

const container = createTestContainer();
after(() => container.dispose());

describe("the container", () => {
  test("every registered token resolves", () => {
    const failures: string[] = [];

    for (const t of container.tokens()) {
      try {
        // `resolve` is typed on `Token<T>`; walking the erased list is exactly
        // the case that needs the cast, and the value is discarded anyway.
        container.resolve(t as never);
      } catch (err) {
        // A scoped registration cannot be resolved from the root by design —
        // that rejection is the captive-dependency guard doing its job, not a
        // wiring gap.
        if (err instanceof ScopeRequiredError) continue;
        failures.push(`${t.description}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    assert.deepEqual(failures, [], `unresolvable registrations:\n${failures.join("\n")}`);
  });

  test("the graph covers every domain", () => {
    // A domain added without a registration would resolve fine — because
    // nothing would ask for it — so the count is asserted separately.
    const names = container.tokens().map((t) => t.description);
    for (const expected of [
      "config",
      "clients",
      "events",
      "health",
      "collections",
      "migration",
      "users",
      "arrLibrary",
      "arrActivity",
      "arrSettings",
      "aiUsage",
      "apiKeys",
      "downloadClients",
      "match",
      "problems",
      "qualitySwaps",
      "recommendations",
      "ruleDrafts",
    ]) {
      assert.ok(names.includes(expected), `no registration for "${expected}"`);
    }
  });

  /**
   * The two genuine cycles: notifications emits events and events notifies;
   * collections triggers a migration rescan while migration reads collections.
   * Both are late-bound closures, so construction must not recurse.
   */
  test("the events/notifications cycle constructs", () => {
    const events = container.resolve((container.tokens().find((t) => t.description === "events") ?? null) as never);
    assert.ok(events);
  });

  test("health reports reach the reporter rather than a no-op", () => {
    const clients = container.tokens().find((t) => t.description === "clients");
    assert.ok(clients, "clients must be registered");
    // Resolving `clients` forces `HealthReporterToken`, which in the real graph
    // is `domains/health`. If that edge were missing this would throw rather
    // than silently wire up a function that discards its arguments.
    assert.doesNotThrow(() => container.resolve(clients as never));
  });
});
