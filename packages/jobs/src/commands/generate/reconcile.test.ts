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
import type { JobContext } from "@tinkerbell/core";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken } from "@tinkerbell/db";
import { ConfigStoreToken, displayTitle } from "@tinkerbell/core";
import { collections, rules } from "@tinkerbell/db";
import { eq } from "drizzle-orm";
import { noopCheckpoint } from "@tinkerbell/core";
import { createGenerateCommand } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run: runGenerate } = createGenerateCommand(services);

const { startMockPlex } = await import("../../test-support/mock-plex-server.ts");

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
      scope: c.createScope("test"),
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
  // The mirror is what the run checks titles against; a collection left there
  // by an earlier test would look like a clash.
  db.delete(collections).run();
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

  it("rebuilds a collection Plex refuses to add to, instead of failing every night", async () => {
    // The shell a duplicate title leaves behind: listed, readable, and a 400
    // on every add. Seen on a real server — seven rules failed on it nightly.
    seedRule("Horror");
    await run();
    const shell = owned()[0];
    assert.ok(shell);
    // Something new matches, so the run has to add.
    const joined = plex.items.get("200");
    assert.ok(joined);
    joined.genre = "Horror";
    plex.failWith("PUT", `/library/collections/${shell.ratingKey}/items`, 400);
    resetJournal();

    const log = await run();

    plex.failWith("PUT", `/library/collections/${shell.ratingKey}/items`, null);
    assert.ok(log.some((l) => l.includes("rebuilding it")));
    assert.deepEqual(plex.journal.deletedCollections, [shell.ratingKey]);
    assert.equal(plex.journal.createdCollections.length, 1);
    assert.equal(owned()[0]?.memberKeys.length, 7);
  });

  it("builds again a collection that vanished between listing and reading it", async () => {
    seedRule("Horror");
    await run();
    const gone = owned()[0];
    assert.ok(gone);
    // Readable when the run takes stock, gone when the rule gets to it.
    plex.failWith("GET", `/library/metadata/${gone.ratingKey}`, 404, { after: 1 });
    resetJournal();

    const log = await run();

    plex.failWith("GET", `/library/metadata/${gone.ratingKey}`, null);
    assert.ok(log.some((l) => l.includes("no longer in Plex")));
    assert.equal(plex.journal.createdCollections.length, 1, "built rather than failing the run");
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

describe("titles another collection already has", () => {
  // Plex pools static collections by title: a second one under a taken title
  // is an empty shell, and its films land in the first. The mock doesn't
  // model the pooling, so these pin what the run does about it.
  const OTHER_RULE = "other-rule";

  function seedTwoRules(): void {
    seedRule("Horror");
    db.insert(rules)
      .values({
        id: OTHER_RULE,
        name: "Funny films",
        type: "smart_filter",
        enabled: 1,
        createdAt: Date.now(),
        position: 1,
        config: {
          smartFilter: {
            kind: "group",
            combinator: "all",
            children: [{ kind: "leaf", field: "genre", op: "=", value: "Comedy" }],
          },
          // The same name, as Actors and Directors both make "Quentin Tarantino".
          collectionName: "Scary Films",
          pinToHomepage: false,
        },
      })
      .run();
  }

  const byRule = (ruleId: string) => [...plex.collections.values()].filter((c) => c.labels.includes(`Rule:${ruleId}`));

  it("gives the second rule's collection a title of its own, and finds it again next run", async () => {
    seedTwoRules();
    const log = await run();

    const [mine] = byRule(RULE_ID);
    const [theirs] = byRule(OTHER_RULE);
    assert.ok(mine && theirs);
    assert.notEqual(mine.title, theirs.title, "two collections, two tags");
    assert.equal(displayTitle(mine.title), displayTitle(theirs.title), "but they read the same");
    assert.ok(log.some((l) => l.includes("giving this one a title of its own")));

    resetJournal();
    await run();
    assert.deepEqual(plex.journal.createdCollections, [], "the marked one is found under the rule's name");
    assert.deepEqual(plex.journal.deletedCollections, []);
  });

  it("rebuilds an existing shell under a title of its own, and leaves the populated twin alone", async () => {
    seedRule("Horror");
    await run();
    const [shell] = byRule(RULE_ID);
    assert.ok(shell);
    // Another collection in Films now holds the title, and this one is empty:
    // the state Plex leaves a shell in.
    shell.memberKeys.length = 0;
    db.insert(collections)
      .values({
        plexRatingKey: "9999",
        sectionId: "1",
        sectionTitle: "Films",
        title: "Scary Films",
        labels: ["Rule:someone-else"],
        syncedAt: Date.now(),
      })
      .run();
    resetJournal();

    const log = await run();

    db.delete(collections).where(eq(collections.plexRatingKey, "9999")).run();
    assert.ok(log.some((l) => l.includes("shares its title with another rule's collection")));
    assert.deepEqual(plex.journal.deletedCollections, [shell.ratingKey]);
    const [rebuilt] = byRule(RULE_ID);
    assert.notEqual(rebuilt?.title, "Scary Films");
    assert.equal(displayTitle(rebuilt?.title ?? ""), "Scary Films");
    assert.equal(rebuilt?.memberKeys.length, 6);
  });
});

it("leaves a shell alone when its twin is a collection no rule manages", async () => {
  // Deleting the shell would take the tag off every film in a hand-made
  // collection, and nothing would ever put them back.
  seedRule("Horror");
  await run();
  const [shell] = [...plex.collections.values()].filter((c) => c.labels.includes(`Rule:${RULE_ID}`));
  assert.ok(shell);
  shell.memberKeys.length = 0;
  db.insert(collections)
    .values({
      plexRatingKey: "9998",
      sectionId: "1",
      sectionTitle: "Films",
      title: "Scary Films",
      syncedAt: Date.now(),
    })
    .run();
  resetJournal();

  const log = await run();

  db.delete(collections).where(eq(collections.plexRatingKey, "9998")).run();
  assert.ok(log.some((l) => l.includes("no rule manages")));
  assert.deepEqual(plex.journal.deletedCollections, []);
  assert.deepEqual(plex.journal.collectionItemAdds, []);
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
