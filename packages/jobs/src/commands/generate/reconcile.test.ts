/**
 * A rule run used to be delete-then-recreate, which is idempotent in the way a
 * bomb crater is: the end state is right, and everything that was there is
 * gone. Reconciling makes the end state right by touching only what differs.
 *
 * The failure modes worth guarding are all about what *doesn't* happen. A
 * second identical run must write nothing at all — that is the whole point, and
 * it is invisible from the outside, because a run that pointlessly rebuilds
 * every collection produces exactly the same collections. The rest is the two
 * things recreation handled by accident: leftovers and pins.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";

setupTempDb("tinkerbell-reconcile-");

const { db, rules } = await import("@tinkerbell/db");
const { setConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { startMockPlex } = await import("../../test-support/mock-plex-server.ts");
const { default: runGenerate } = await import("./index.ts");

const RULE_ID = "reconcile-rule";
const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

/** Six horror films and three comedies, so a genre rule selects a real subset. */
const ITEMS = [
  ...["100", "101", "102", "103", "104", "105"].map((ratingKey, i) => ({
    ratingKey,
    title: `Horror ${i}`,
    sectionId: "1",
    genre: "Horror",
    guids: [],
    labels: [],
  })),
  ...["200", "201", "202"].map((ratingKey, i) => ({
    ratingKey,
    title: `Comedy ${i}`,
    sectionId: "1",
    genre: "Comedy",
    guids: [],
    labels: [],
  })),
];

let plex: MockPlex;

function testContext(): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

/** A smart-filter rule selecting one genre into a single named collection. */
function seedRule(genre: string, extra: Record<string, unknown> = {}): void {
  db.delete(rules).run();
  db.insert(rules)
    .values({
      id: RULE_ID,
      name: "Scary films",
      type: "smart_filter",
      enabled: 1,
      createdAt: Date.now(),
      config: {
        smartFilter: {
          kind: "group",
          combinator: "all",
          children: [{ kind: "leaf", field: "genre", op: "=", value: genre }],
        },
        collectionName: "Scary Films",
        pinToHomepage: false,
        ...extra,
      },
    })
    .run();
}

async function run(): Promise<string[]> {
  const { ctx, log } = testContext();
  await runGenerate(ctx, {});
  return log;
}

/** Everything this rule owns in Plex right now. */
function owned(): Array<{ ratingKey: string; title: string; memberKeys: string[] }> {
  return [...plex.collections.values()]
    .filter((c) => c.labels.some((l) => l === `Rule:${RULE_ID}`))
    .map((c) => ({ ratingKey: c.ratingKey, title: c.title, memberKeys: [...c.memberKeys] }));
}

function resetJournal(): void {
  plex.journal.createdCollections.length = 0;
  plex.journal.deletedCollections.length = 0;
  plex.journal.collectionItemAdds.length = 0;
  plex.journal.collectionItemRemoves.length = 0;
  plex.journal.summaryWrites.length = 0;
  plex.journal.pinned.length = 0;
  plex.journal.unpinned.length = 0;
}

before(async () => {
  plex = await startMockPlex({ sections: SECTIONS, items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "token");
  // Kometa auto-posters would put an outbound fetch behind every create.
  setConfig("posters_kometa_enabled", false);
});

after(async () => {
  await plex?.close();
});

beforeEach(() => {
  plex.collections.clear();
  // These tests change what matches by editing genres in place, and the mock's
  // item map is shared for the life of the server.
  for (const item of ITEMS) {
    const live = plex.items.get(item.ratingKey);
    if (live) live.genre = item.genre;
  }
  resetJournal();
});

describe("reconciling a rule's collections", () => {
  it("builds the collection on a first run", async () => {
    seedRule("Horror");
    await run();

    const collections = owned();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.title, "Scary Films");
    assert.equal(collections[0]?.memberKeys.length, 6);
    assert.equal(plex.journal.createdCollections.length, 1);
  });

  it("a second identical run writes nothing at all", async () => {
    // The case that matters, and the one that is invisible from the outside: a
    // rebuild would produce exactly the same collection. Under the old model
    // this was a delete, a create, a label write, a summary write and a poster
    // upload, every night, for a shelf that had not changed.
    seedRule("Horror");
    await run();
    const first = owned()[0];
    resetJournal();

    await run();

    assert.deepEqual(plex.journal.createdCollections, []);
    assert.deepEqual(plex.journal.deletedCollections, []);
    assert.deepEqual(plex.journal.collectionItemAdds, []);
    assert.deepEqual(plex.journal.collectionItemRemoves, []);
    assert.deepEqual(plex.journal.summaryWrites, []);
    // And the collection is the same one, not a replacement wearing its name.
    assert.equal(owned()[0]?.ratingKey, first?.ratingKey);
  });

  it("applies only the difference when membership changes", async () => {
    seedRule("Horror");
    await run();
    const before = owned()[0];
    resetJournal();

    // One horror film becomes a comedy, so the rule should shed exactly it.
    const moved = plex.items.get("105");
    assert.ok(moved);
    moved.genre = "Comedy";

    await run();

    assert.deepEqual(plex.journal.createdCollections, [], "no rebuild");
    assert.deepEqual(plex.journal.collectionItemAdds, [], "nothing new matched");
    assert.deepEqual(
      plex.journal.collectionItemRemoves.map((r) => r.itemKey),
      ["105"],
    );
    assert.equal(owned()[0]?.ratingKey, before?.ratingKey);
    assert.equal(owned()[0]?.memberKeys.includes("105"), false);
  });

  it("rebuilds rather than removing item by item once churn is high", async () => {
    // Plex has no bulk remove, so past roughly half the collection one POST
    // beats N DELETEs — and a rebuild restores the intended order too.
    seedRule("Horror");
    await run();
    resetJournal();

    // Five of the six no longer match: well past the ratio.
    for (const key of ["101", "102", "103", "104", "105"]) {
      const item = plex.items.get(key);
      assert.ok(item);
      item.genre = "Comedy";
    }

    await run();

    assert.equal(plex.journal.createdCollections.length, 1, "rebuilt");
    assert.deepEqual(plex.journal.collectionItemRemoves, [], "not one at a time");
    assert.deepEqual(owned()[0]?.memberKeys, ["100"]);
  });

  it("removes a collection the rule no longer produces", async () => {
    // The counterpart to not deleting up front: nothing else would ever take
    // this shelf down.
    seedRule("Horror");
    await run();
    assert.equal(owned().length, 1);
    resetJournal();

    // Nothing matches any more, so the rule produces no collection at all.
    for (const item of plex.items.values()) item.genre = "Comedy";

    await run();

    assert.equal(owned().length, 0);
    assert.equal(plex.journal.deletedCollections.length, 1);
  });

  it("leaves a collection alone when the run failed before producing it", async () => {
    // A rule that threw halfway has an incomplete produced set, and sweeping
    // against it would delete shelves the rule still makes.
    seedRule("Horror");
    await run();
    const before = owned();
    assert.equal(before.length, 1);

    const { ctx } = testContext();
    const aborted = new AbortController();
    aborted.abort();
    await runGenerate({ ...ctx, signal: aborted.signal }, {}).catch(() => {});

    assert.equal(owned().length, 1, "the collection survived an aborted run");
  });
});

describe("the homepage", () => {
  it("pins what the rule asks for and unpins what it stops asking for", async () => {
    // Recreation cleared pins by accident — the collection carrying the pin was
    // deleted. A reconciled collection keeps it, so a rule switched to unpinned
    // would leave a row on the home screen that nothing intends to be there.
    seedRule("Horror", { pinToHomepage: true });
    await run();
    const collection = owned()[0];
    assert.ok(collection);
    assert.deepEqual(plex.journal.pinned, [collection.ratingKey]);

    resetJournal();
    seedRule("Horror", { pinToHomepage: false });
    await run();

    assert.deepEqual(plex.journal.unpinned, [collection.ratingKey]);
    assert.deepEqual(plex.journal.pinned, []);
  });

  it("does not re-pin something already pinned", async () => {
    seedRule("Horror", { pinToHomepage: true });
    await run();
    resetJournal();

    await run();

    assert.deepEqual(plex.journal.pinned, []);
    assert.deepEqual(plex.journal.unpinned, []);
  });
});
