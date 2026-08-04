/**
 * The cheap test that pays for itself: it makes the three-list drift that
 * `catalog.ts` was created to prevent impossible to reintroduce without also
 * turning it into a test failure.
 *
 * No database is needed — the catalog is pure data, and each `load()` thunk is
 * a static import.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "../test-support/temp-db.ts";
import { COMMANDS, isCommandName, type CommandName } from "./catalog.ts";

// The catalog itself needs no database, but `load()` pulls in command modules
// that import `@tinkerbell/db` — which connects at import time. Point that at
// a throwaway directory so running the tests can't touch a real install.
setupTempDb();

describe("command catalog", () => {
  it("resolves every load() to a module with a default export", async () => {
    for (const [name, descriptor] of Object.entries(COMMANDS)) {
      const mod = await descriptor.load();
      assert.equal(typeof mod.default, "function", `${name} has no default export`);
    }
  });

  it("gives every command a lane and a positive timeout", () => {
    for (const [name, descriptor] of Object.entries(COMMANDS)) {
      assert.ok(
        descriptor.lane === "default" || descriptor.lane === "interactive",
        `${name} has an unknown lane: ${descriptor.lane}`,
      );
      assert.ok(descriptor.timeoutMs > 0, `${name} has a non-positive timeout`);
    }
  });

  it("routes human-triggered work to the interactive lane", () => {
    // These are the commands a user clicks and then watches. If one of them
    // ends up on `default` it queues behind the nightly batch work, which is
    // the exact problem the second lane exists to solve.
    const interactive: CommandName[] = [
      "preroll-process",
      "label",
      "label-undo",
      "overlays",
      "byw-remove",
      "personalize-enable",
      "personalize-disable",
      "migrate-collections",
    ];
    for (const name of interactive) {
      assert.equal(COMMANDS[name].lane, "interactive", `${name} should be on the interactive lane`);
    }
  });

  it("narrows unknown names", () => {
    assert.equal(isCommandName("generate"), true);
    assert.equal(isCommandName("nope"), false);
    // Object.hasOwn, not `in` — an inherited key is not a command.
    assert.equal(isCommandName("toString"), false);
    assert.equal(isCommandName("constructor"), false);
  });
});
