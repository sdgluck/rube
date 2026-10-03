import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyConfigPatch, configSchemaFor, lockedConfigFor, validateJobConfig } from "./job-config.ts";

describe("applyConfigPatch", () => {
  it("sets, clears with null, and treats empty selection lists as 'all'", () => {
    const merged = applyConfigPatch(
      { limit: 1, mode: "server", sections: ["A"], users: ["x"] },
      { limit: 2, mode: null, sections: [], users: ["y", "z"] },
    );
    assert.deepEqual(merged, { limit: 2, users: ["y", "z"] });
  });

  it("does not mutate the stored object", () => {
    const stored = { limit: 1 };
    applyConfigPatch(stored, { limit: 2 });
    assert.deepEqual(stored, { limit: 1 });
  });
});

describe("validateJobConfig", () => {
  it("re-applies a job's locked keys", () => {
    assert.deepEqual(validateJobConfig("overlays", "overlays-remove", {}), { mode: "remove" });
    assert.deepEqual(lockedConfigFor("overlays"), {});
  });

  it("falls back to the common schema for a command without its own", () => {
    assert.equal(configSchemaFor("sync-media"), configSchemaFor("not-a-command"));
    assert.deepEqual(validateJobConfig("sync-media", "sync-media", { sections: ["Films"], extra: 1 }), {
      sections: ["Films"],
    });
  });
});
