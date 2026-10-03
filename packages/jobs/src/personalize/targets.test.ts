import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { createPlexClient } from "@tinkerbell/plex";
import { startMockPlex, type MockPlex } from "@tinkerbell/test-support";
import { isOutOfTarget, removeOutOfTarget, selectTargets, type TargetScope } from "./targets.ts";

const USERS = [{ username: "Alice" }, { username: "bob" }];
const RULES = [{ id: "r1" }, { id: "r2" }];

describe("selectTargets", () => {
  it("covers everyone and everything when nothing is targeted", () => {
    const t = selectTargets(USERS, RULES, {});
    assert.equal(t.users.length, 2);
    assert.equal(t.rules.length, 2);
  });

  it("narrows case-insensitively, and reports targets it can't honour", () => {
    const t = selectTargets(USERS, RULES, { users: ["alice", "carol"], ruleIds: ["r2", "gone"] });
    assert.deepEqual(
      t.users.map((u) => u.username),
      ["Alice"],
    );
    assert.deepEqual(
      t.rules.map((r) => r.id),
      ["r2"],
    );
    assert.deepEqual(t.notOptedIn, ["carol"], "a target never overrides the portal opt-in");
    assert.deepEqual(t.unknownRules, ["gone"]);
  });
});

const SCOPE: TargetScope = {
  optedIn: new Set(["alice", "bob"]),
  personalizable: new Set(["r1", "r2"]),
  targetUsers: new Set(["alice"]),
  targetRules: new Set(["r1", "r2"]),
};

describe("isOutOfTarget", () => {
  it("matches this job's collection for an untargeted user", () => {
    assert.equal(isOutOfTarget(["Tinkerbell", "User:bob", "Rule:r1"], SCOPE), true);
    assert.equal(isOutOfTarget(["Tinkerbell", "User:Alice", "Rule:r1"], SCOPE), false);
  });

  it("never matches what this job didn't make or doesn't know", () => {
    // Because You Watched: a user label but no rule label.
    assert.equal(isOutOfTarget(["Tinkerbell", "User:bob"], SCOPE), false);
    // No baseline label: not Tinkerbell's.
    assert.equal(isOutOfTarget(["User:bob", "Rule:r1"], SCOPE), false);
    // A user who has opted out is the opt-out's business, not targeting's.
    assert.equal(isOutOfTarget(["Tinkerbell", "User:dave", "Rule:r1"], SCOPE), false);
    // A rule that is no longer personalizable.
    assert.equal(isOutOfTarget(["Tinkerbell", "User:bob", "Rule:r9"], SCOPE), false);
  });
});

describe("removeOutOfTarget, against the mock Plex", () => {
  let plex: MockPlex;
  before(async () => {
    plex = await startMockPlex({ sections: [{ key: "1", title: "Films", type: "movie" }], items: [] });
    const add = (ratingKey: string, labels: string[]) =>
      plex.collections.set(ratingKey, { ratingKey, title: `Col ${ratingKey}`, sectionId: "1", labels, memberKeys: [] });
    add("10", ["Tinkerbell", "User:Alice", "Rule:r1"]);
    add("11", ["Tinkerbell", "User:bob", "Rule:r1"]);
    add("12", ["Tinkerbell", "User:bob"]);
    add("13", ["Hand made"]);
  });
  after(() => plex.close());

  it("deletes only the untargeted pairs, and logs each", async () => {
    const log: string[] = [];
    const client = createPlexClient({ url: plex.origin, token: "t" });
    const removed = await removeOutOfTarget(client, [{ key: "1", title: "Films", type: "movie" } as never], SCOPE, {
      log: (m: unknown) => log.push(String(m)),
    });
    assert.deepEqual(removed, ["11"]);
    assert.deepEqual(plex.journal.deletedCollections.concat(plex.journal.deletedItems), ["11"]);
    assert.equal(log.length, 1);
  });
});
