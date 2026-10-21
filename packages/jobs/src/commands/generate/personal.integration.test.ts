/**
 * A personalisable rule builds each opted-in person's copy in its own run.
 *
 * What's protected is mostly what used to go wrong when a separate job built
 * the copies: the rule's run deleting every copy as "no longer produced", the
 * rule recording a person's copy as its own collection, and copies that were
 * deleted and recreated every night rather than kept.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { ConfigStoreToken, noopCheckpoint, personalRowTitle, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, plexUsers, rules, userPreferences } from "@rube/db";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";
import { createGenerateCommand } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const generate = createGenerateCommand(services);
const { startMockPlex } = await import("../../test-support/mock-plex-server.ts");

const RULE_ID = "personal-rule";
const ITEMS = ["100", "101", "102", "103", "104", "105"].map((ratingKey, i) => ({
  ratingKey,
  title: `Horror ${i}`,
  sectionId: "1",
  genre: "Horror",
  guids: [],
  labels: [],
}));

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

function seedRule(id: string, position: number, extra: Record<string, unknown> = {}): void {
  db.insert(rules)
    .values({
      id,
      name: id,
      type: "smart_filter",
      enabled: 1,
      position,
      createdAt: Date.now(),
      config: {
        smartFilter: {
          kind: "group",
          combinator: "all",
          children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
        },
        collectionName: `Scary (${id})`,
        pinToHomepage: false,
        personalizable: true,
        ...extra,
      },
    })
    .run();
}

function optIn(userId: number, username: string, isOwner: boolean, prefs: Record<string, unknown> = {}): void {
  const now = Date.now();
  db.insert(plexUsers)
    .values({ userId, username, label: username, isOwner: isOwner ? 1 : 0, syncedAt: now })
    .run();
  db.insert(userPreferences).values({ userId, preferences: prefs, optedIn: 1, updatedAt: now }).run();
}

async function run(): Promise<string[]> {
  const { ctx, log } = testContext();
  await generate.run(ctx, {});
  return log;
}

const ofRule = (id = RULE_ID) => [...plex.collections.values()].filter((col) => col.labels.includes(`Rule:${id}`));
const shared = (id = RULE_ID) => ofRule(id).filter((col) => !col.labels.some((l) => l.startsWith("User:")));
const copyOf = (username: string, id = RULE_ID) => ofRule(id).find((col) => col.labels.includes(`User:${username}`));

before(async () => {
  plex = await startMockPlex({ sections: [{ key: "1", title: "Films", type: "movie" }], items: ITEMS });
});
after(async () => plex?.close());

beforeEach(() => {
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("posters_kometa_enabled", false);
  setConfig("global_personalized_sharing", { status: "enabled" });
  db.delete(rules).run();
  db.delete(userPreferences).run();
  db.delete(plexUsers).run();
  seedRule(RULE_ID, 0);
  optIn(10, "alice", false, { excludedTitles: ["Horror 0"] });
  optIn(11, "bob", true);
});

describe("personal copies in a rule's run", () => {
  it("builds the shared collection and a copy for each opted-in person", async () => {
    await run();

    assert.equal(shared().length, 1);
    const alice = copyOf("alice")!;
    const bob = copyOf("bob")!;
    assert.equal(alice.title, personalRowTitle(`Scary (${RULE_ID})`, "alice"));
    assert.equal(bob.title, personalRowTitle(`Scary (${RULE_ID})`, "bob"));
    assert.ok(!alice.labels.includes("Rube"), "a copy never carries the baseline label");
    assert.ok(!alice.memberKeys.includes("100"), "her excluded title is left out");
    assert.equal(bob.memberKeys.length, 6);
    // Each copy on its own person's Home: the owner's own, everyone else's
    // shared — and off the Recommended tab, which the owner sees unfiltered.
    const homes = new Map(plex.journal.pinHomes.map((p) => [p.ratingKey, p]));
    assert.deepEqual(homes.get(alice.ratingKey), {
      ratingKey: alice.ratingKey,
      own: false,
      shared: true,
      recommended: false,
    });
    assert.deepEqual(homes.get(bob.ratingKey), {
      ratingKey: bob.ratingKey,
      own: true,
      shared: false,
      recommended: true,
    });
  });

  it("keeps the copies on the next run rather than deleting them", async () => {
    await run();
    const before = ofRule()
      .map((col) => col.ratingKey)
      .sort();
    for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;

    await run();
    assert.deepEqual(plex.journal.deletedCollections, [], "the rule's sweep must not take the copies");
    assert.deepEqual(plex.journal.createdCollections, []);
    assert.deepEqual(
      ofRule()
        .map((col) => col.ratingKey)
        .sort(),
      before,
    );
  });

  it("takes a shared user's existing copy off Recommended, and leaves the owner's", async () => {
    await run();
    const alice = copyOf("alice")!;
    const bob = copyOf("bob")!;
    // As pinned before the flag was spelled the way Plex reads it.
    const manage = (key: string, query: string) =>
      fetch(`${plex.origin}/hubs/sections/1/manage/custom.collection.1.${key}?${query}`, {
        method: "PUT",
        signal: AbortSignal.timeout(5000),
      });
    await manage(alice.ratingKey, "promotedToOwnHome=0&promotedToRecommended=1&promotedToSharedHome=1");
    await manage(bob.ratingKey, "promotedToOwnHome=1&promotedToRecommended=1&promotedToSharedHome=0");
    for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;

    await run();
    assert.deepEqual(plex.journal.pinHomes, [
      { ratingKey: alice.ratingKey, own: false, shared: true, recommended: false },
    ]);

    for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
    await run();
    assert.deepEqual(plex.journal.pinHomes, [], "once it's off, nothing more to do");
  });

  it("records the shared collection as the rule's, never a person's copy", async () => {
    await run();
    const rule = db.select().from(rules).where(eq(rules.id, RULE_ID)).get()!;
    assert.equal(rule.lastCollectionRatingKey, shared()[0].ratingKey);
  });

  it("removes only the copy of someone who opted out", async () => {
    await run();
    const bobKey = copyOf("bob")!.ratingKey;
    db.update(userPreferences).set({ optedIn: 0 }).where(eq(userPreferences.userId, 10)).run();

    await run();
    assert.equal(copyOf("alice"), undefined);
    assert.equal(copyOf("bob")?.ratingKey, bobKey);
    assert.equal(shared().length, 1);
  });

  it("removes every copy when the rule stops being personalisable, and keeps the shared collection", async () => {
    await run();
    db.update(rules)
      .set({ config: { ...db.select().from(rules).get()!.config, personalizable: false } })
      .run();

    await run();
    assert.equal(ofRule().length, 1);
    assert.equal(shared().length, 1);
  });

  it("leaves copies alone while personalized home screens are off", async () => {
    await run();
    setConfig("global_personalized_sharing", { status: "disabled" });
    for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;

    await run();
    assert.deepEqual(plex.journal.deletedCollections, []);
    assert.ok(copyOf("alice") && copyOf("bob"));
  });

  it("skips a row the person declined in the portal", async () => {
    db.update(userPreferences)
      .set({ preferences: { excludedCollections: [`Scary (${RULE_ID})`] } })
      .where(eq(userPreferences.userId, 10))
      .run();
    await run();
    assert.equal(copyOf("alice"), undefined);
    assert.ok(copyOf("bob"));
  });

  it("counts a person's row cap across rules in list order", async () => {
    seedRule("earlier-rule", -1);
    db.update(userPreferences)
      .set({ preferences: { rowCount: 1 } })
      .where(eq(userPreferences.userId, 11))
      .run();
    // The cap reads earlier rules' copies from the local index, so it holds
    // from the run after they exist.
    await run();
    await run();
    assert.ok(copyOf("bob", "earlier-rule"), "the earlier rule takes his one row");
    assert.equal(copyOf("bob"), undefined, "so this one doesn't get a copy");
    assert.ok(copyOf("alice"), "uncapped people get both");
  });

  it("replaces a copy made before per-person titles", async () => {
    plex.collections.set("9100", {
      ratingKey: "9100",
      title: `Scary (${RULE_ID})`,
      sectionId: "1",
      labels: [`Rule:${RULE_ID}`, "User:alice"],
      memberKeys: [],
    });
    await run();
    assert.ok(plex.journal.deletedCollections.includes("9100"));
    assert.equal(copyOf("alice")?.title, personalRowTitle(`Scary (${RULE_ID})`, "alice"));
  });

  it("builds copies when one rule is run on its own", async () => {
    const { ctx } = testContext();
    await generate.runSingleRule(RULE_ID, undefined, ctx);
    assert.ok(copyOf("alice") && copyOf("bob"));
  });
});
