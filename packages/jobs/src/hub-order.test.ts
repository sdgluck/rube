/**
 * "Keep at the top" against a real-HTTP mock Plex: which hubs count, that a
 * shuffle leaves them first, and that a row pinned at the bottom is put back
 * behind them. The ordering itself is unit-tested in `@rube/domain.shuffle-hubs`;
 * this is the part that reads rule and feature settings and the collections
 * mirror, and talks to Plex over the wire.
 */
import { describe, test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, collections, jobs, rules } from "@rube/db";
import { ConfigStoreToken } from "@rube/core";
import { createPlexClient } from "@rube/plex";
import { shuffleSectionHubs } from "@rube/domain.shuffle-hubs";
import { startMockPlex, type MockPlex } from "@rube/test-support/plex";
import { PIN_TO_TOP_LABELS, createHubOrder, pinsHubs } from "./hub-order.ts";
import { COMMANDS } from "./commands/catalog.ts";

const c = createTestContainer();
const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const hubOrder = createHubOrder(services);

const SECTION = { key: "1", title: "Films", type: "movie" };
let plex: MockPlex;
after(async () => {
  await plex?.close();
  c.dispose();
});

function seedCollection(key: string, labels: string[]): void {
  db.insert(collections)
    .values({
      plexRatingKey: key,
      sectionId: "1",
      sectionTitle: "Films",
      title: `Row ${key}`,
      labels,
      syncedAt: Date.now(),
    })
    .run();
}

function seedRule(id: string, config: Record<string, unknown>): void {
  db.insert(rules).values({ id, name: id, type: "smart_filter", enabled: 1, createdAt: Date.now(), config }).run();
}

function seedFeature(command: string, config: Record<string, unknown>): void {
  db.insert(jobs).values({ id: command, name: command, command, config }).run();
}

function client() {
  return createPlexClient({ url: plex.origin, token: "token" });
}

async function order(): Promise<string[]> {
  return (await client().getManagedHubs("1")).map((h) => h.identifier.split(".").pop()!);
}

beforeEach(async () => {
  db.delete(collections).run();
  db.delete(rules).run();
  db.delete(jobs).run();
  await plex?.close();
  plex = await startMockPlex({ sections: [SECTION], items: [] });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "token");
});

describe("which rows are kept at the top", () => {
  test("a rule's rows and a feature's rows, by label, personal copies included", () => {
    seedRule("top", { pinToTop: true });
    seedRule("plain", {});
    seedFeature("we-think-youd-like", { pinToTop: true });
    seedFeature("leaving-soon", {});
    seedCollection("10", ["Rube", "Rule:top"]);
    seedCollection("11", ["Rule:top", "User:alice"]);
    seedCollection("20", ["Rube", "Rule:plain"]);
    seedCollection("30", ["WeThinkYoudLike", "User:alice"]);
    seedCollection("40", ["Rube", "LeavingSoon"]);
    assert.deepEqual([...hubOrder.topPinnedRatingKeys()].sort(), ["10", "11", "30"]);
  });

  test("nothing, once pinning itself is off", () => {
    seedRule("top", { pinToTop: true, pinToHomepage: false });
    seedFeature("leaving-soon", { pinToTop: true, pinToHomepage: false });
    seedCollection("10", ["Rule:top"]);
    seedCollection("40", ["LeavingSoon"]);
    assert.equal(hubOrder.topPinnedRatingKeys().size, 0);
  });
});

describe("keeping them there", () => {
  test("a row pinned at the bottom is put back in front", async () => {
    seedFeature("we-think-youd-like", { pinToTop: true });
    seedCollection("30", ["WeThinkYoudLike", "User:alice"]);
    for (const key of ["1", "2", "30"]) await client().pinToHomepage("1", key);
    assert.deepEqual(await order(), ["1", "2", "30"]);

    await hubOrder.applyTopPinsEverywhere();
    assert.deepEqual(await order(), ["30", "1", "2"]);
  });

  test("a shuffle leaves them first", async () => {
    seedRule("top", { pinToTop: true });
    seedCollection("10", ["Rule:top"]);
    for (const key of ["10", "1", "2", "3", "4"]) await client().pinToHomepage("1", key);
    for (let i = 0; i < 5; i++) {
      await shuffleSectionHubs(client(), SECTION, undefined, { keepFirst: hubOrder.topPinnedRatingKeys() });
      assert.equal((await order())[0], "10");
    }
  });
});

describe("the label map", () => {
  test("matches each feature's own label constant", async () => {
    const actual: Record<string, string> = {
      "because-you-watched": (await import("./commands/because-you-watched.ts")).BYW_LABEL,
      "we-think-youd-like": (await import("./commands/we-think-youd-like/index.ts")).WTYL_LABEL,
      "pick-it-back-up": (await import("./commands/pick-it-back-up/index.ts")).PIBU_LABEL,
      "season-collections": (await import("./commands/season-collections/match.ts")).SEASON_LABEL,
      "finish-the-franchise": (await import("./commands/finish-the-franchise/index.ts")).FRANCHISE_LABEL,
      "watch-it-again": (await import("./commands/watch-it-again/index.ts")).WATCH_AGAIN_LABEL,
      "new-for-you": (await import("./commands/new-for-you/index.ts")).NEW_FOR_YOU_LABEL,
      "more-from": (await import("./commands/more-from/index.ts")).MORE_FROM_LABEL,
      "requests-arrived": (await import("./commands/requests-arrived/index.ts")).REQUESTS_LABEL,
      "leaving-soon": (await import("./commands/leaving-soon/index.ts")).LEAVING_LABEL,
    };
    assert.deepEqual(PIN_TO_TOP_LABELS, actual);
  });

  test("every feature with a pinToTop setting is in it, and no teardown pins", async () => {
    const { commandsWithFields, fieldsFor } = await import("@rube/contracts");
    const withSetting = commandsWithFields()
      .filter((command) => fieldsFor(command).some((f) => f.key === "pinToTop"))
      .sort();
    assert.deepEqual(withSetting, Object.keys(PIN_TO_TOP_LABELS).sort());
    for (const command of Object.keys(COMMANDS)) {
      if (command.endsWith("-remove")) assert.equal(pinsHubs(command), false, command);
    }
  });
});
