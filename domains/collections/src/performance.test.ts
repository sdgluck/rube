/**
 * The figure that matters is a negative one: a collection of titles that were
 * popular *before* the rule picked them must not score those plays. The other
 * cases pin the two joins that are easy to get quietly wrong — episodes
 * counting towards their show, and anonymous plays not inflating viewers.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { collectionItems, collections, DbToken, playbackSessions, ruleRunChanges, rules } from "@tinkerbell/db";
import { CollectionsToken } from "@tinkerbell/domain.collections";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { getCollectionPerformance, getLocalCollections } = c.resolve(CollectionsToken);

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

let sessionId = 0;
function play(ratingKey: string, at: number, userId = 1, grandparentRatingKey: string | null = null): void {
  db.insert(playbackSessions)
    .values({
      id: `s${++sessionId}`,
      userId,
      username: `u${userId}`,
      ratingKey,
      grandparentRatingKey,
      title: ratingKey,
      type: grandparentRatingKey ? "episode" : "movie",
      startedAt: at,
      lastSeenAt: at,
      endedAt: at,
    })
    .run();
}

function collection(key: string, members: string[]): void {
  db.insert(collections)
    .values({ plexRatingKey: key, sectionId: "1", sectionTitle: "Movies", title: key, syncedAt: 0 })
    .run();
  for (const m of members) db.insert(collectionItems).values({ collectionRatingKey: key, itemRatingKey: m }).run();
}

function joined(collectionKey: string, item: string, at: number): void {
  db.insert(ruleRunChanges)
    .values({
      runId: "r",
      ruleId: "rule",
      sectionKey: "1",
      sectionTitle: "Movies",
      collectionName: collectionKey,
      collectionRatingKey: collectionKey,
      itemRatingKey: item,
      itemTitle: item,
      change: "added",
      at,
    })
    .run();
}

beforeEach(() => {
  for (const t of [playbackSessions, collectionItems, collections, ruleRunChanges, rules]) db.delete(t).run();
  db.insert(rules).values({ id: "rule", name: "Rule", type: "collection", createdAt: 0 }).run();
});

test("plays before a title joined the collection don't count", () => {
  collection("c", ["m1", "m2"]);
  joined("c", "m1", NOW - 10 * DAY);
  play("m1", NOW - 20 * DAY); // before it joined
  play("m1", NOW - 5 * DAY, 2);
  play("m2", NOW - 30 * DAY); // never diffed: counts from the window start

  const perf = getCollectionPerformance(["c"], NOW).get("c");
  assert.deepEqual(perf, { members: 2, playedMembers: 2, plays: 2, viewers: 2, lastPlayedAt: NOW - 5 * DAY });
});

test("plays outside the window don't count, and an unplayed collection still reports its members", () => {
  collection("c", ["m1"]);
  play("m1", NOW - 200 * DAY);
  assert.deepEqual(getCollectionPerformance(["c"], NOW).get("c"), {
    members: 1,
    playedMembers: 0,
    plays: 0,
    viewers: 0,
    lastPlayedAt: null,
  });
});

test("an episode counts towards its show, and unknown users aren't a viewer", () => {
  collection("tv", ["show"]);
  play("ep1", NOW - DAY, 0, "show");
  play("ep2", NOW - DAY, 0, "show");
  const perf = getCollectionPerformance(["tv"], NOW).get("tv");
  assert.equal(perf?.plays, 2);
  assert.equal(perf?.viewers, 0);
});

test("the list sorts by plays across pages, not within one", () => {
  collection("a", ["m1"]);
  collection("b", ["m2"]);
  collection("z", ["m3"]);
  play("m3", Date.now() - DAY);
  play("m3", Date.now() - DAY);
  play("m1", Date.now() - DAY);

  const first = getLocalCollections({ sort: "plays", sortDir: "desc", limit: 1, offset: 0 });
  assert.equal(first.total, 3);
  assert.deepEqual(
    first.items.map((r) => r.plexRatingKey),
    ["z"],
  );
  const rest = getLocalCollections({ sort: "plays", sortDir: "desc", limit: 2, offset: 1 });
  assert.deepEqual(
    rest.items.map((r) => r.plexRatingKey),
    ["a", "b"],
  );
});
