import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fieldsFor } from "@tinkerbell/contracts";
import { draftFromConfig, isVisible, patchFromDraft } from "./config-draft.ts";

const BYW = fieldsFor("because-you-watched");

describe("draftFromConfig", () => {
  it("shows the stored value, else the default the job would use", () => {
    const draft = draftFromConfig(BYW, { limit: 4 });
    assert.equal(draft.limit, 4);
    assert.equal(draft.maxItems, 30);
    assert.deepEqual(draft.sections, []);
    assert.deepEqual(draft.users, []);
  });
});

describe("patchFromDraft", () => {
  it("sends only what changed", () => {
    const stored = { limit: 4, mode: "server" };
    const draft = { ...draftFromConfig(BYW, stored), limit: 6 };
    assert.deepEqual(patchFromDraft(BYW, stored, draft), { limit: 6 });
  });

  it("sends nothing for an untouched form", () => {
    const stored = { limit: 4 };
    assert.deepEqual(patchFromDraft(BYW, stored, draftFromConfig(BYW, stored)), {});
  });

  it("clears a field set back to its default rather than storing the default", () => {
    const stored = { limit: 4 };
    const draft = { ...draftFromConfig(BYW, stored), limit: 10 };
    assert.deepEqual(patchFromDraft(BYW, stored, draft), { limit: null });
  });

  it("sends an emptied list as empty, which the server stores as 'all'", () => {
    const stored = { sections: ["Films"] };
    const draft = { ...draftFromConfig(BYW, stored), sections: [] };
    assert.deepEqual(patchFromDraft(BYW, stored, draft), { sections: [] });
  });
});

describe("isVisible", () => {
  it("hides the user list when collections are built from everyone's history", () => {
    const users = BYW.find((f) => f.key === "users")!;
    assert.equal(isVisible(users, { mode: "per-user" }), true);
    assert.equal(isVisible(users, { mode: "server" }), false);
  });
});
