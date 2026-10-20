/**
 * New For You end to end: a mock Plex over HTTP, the library index and play
 * history seeded locally, the clock pinned.
 *
 * What's protected: the row holds what arrived inside the window that the
 * person hasn't seen, ordered by their taste — so two people get the same
 * arrivals in different orders — and a person with no history still gets a
 * row, newest first.
 *
 * The built-in recommender is off in tests (no model is shipped to them), so
 * this exercises the genre-share tier of the shared taste order.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, mediaItems, playbackSessions, plexUsers, userPreferences, watchState } from "@tinkerbell/db";
import { ClockToken } from "@tinkerbell/ports";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createNewForYouCommand, NEW_FOR_YOU_LABEL } from "./index.ts";
import { createNewForYouRemoveCommand } from "../new-for-you-remove.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

const c = createTestContainer({ now: NOW });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createNewForYouCommand(services, { now: c.resolve(ClockToken) });
const { run: remove } = createNewForYouRemoveCommand(services);

/** Rating key, title, genres, added days ago. 1xx are new; 2xx are what history was built from. */
const LIBRARY = [
  { key: "100", title: "New Comedy", genres: ["Comedy"], added: 3 },
  { key: "101", title: "New Horror", genres: ["Horror"], added: 1 },
  { key: "102", title: "New Drama", genres: ["Drama"], added: 5 },
  { key: "103", title: "Already Seen", genres: ["Comedy"], added: 2 },
  { key: "104", title: "Old Arrival", genres: ["Comedy"], added: 90 },
  { key: "200", title: "Old Comedy", genres: ["Comedy"], added: 400 },
  { key: "201", title: "Old Comedy 2", genres: ["Comedy"], added: 400 },
];

let plex: MockPlex;

function testContext(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

const rowsOf = (username: string) =>
  [...plex.collections.values()].filter((r) => r.labels.includes(`User:${username}`));

/** Alice (10) watched `key` through, `daysAgo`. */
function watched(key: string, daysAgo: number): void {
  const at = NOW - daysAgo * DAY;
  db.insert(playbackSessions)
    .values({
      id: `${key}-${daysAgo}`,
      userId: 10,
      username: "alice",
      ratingKey: key,
      title: key,
      type: "movie",
      startedAt: at,
      lastSeenAt: at,
      completionPct: 1,
    })
    .run();
  db.insert(watchState)
    .values({ ratingKey: key, userId: 10, plays: 1, completedPlays: 1, lastPlayedAt: at, maxCompletionPct: 1 })
    .run();
}

before(async () => {
  plex = await startMockPlex({
    sections: [{ key: "1", title: "Films", type: "movie" }],
    items: LIBRARY.map((l) => ({ ratingKey: l.key, title: l.title, sectionId: "1", guids: [], labels: [] })),
  });
});
after(async () => plex?.close());

beforeEach(() => {
  c.setNow(NOW);
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  for (const table of [plexUsers, mediaItems, watchState, playbackSessions, userPreferences]) db.delete(table).run();
  db.insert(plexUsers)
    .values([
      { userId: 10, username: "alice", label: "alice", syncedAt: 0 },
      { userId: 11, username: "bob", label: "bob", syncedAt: 0 },
    ])
    .run();
  db.insert(mediaItems)
    .values(
      LIBRARY.map((l) => ({
        ratingKey: l.key,
        sectionId: "1",
        sectionTitle: "Films",
        title: l.title,
        type: "movie",
        genres: l.genres,
        // Plex's unit: seconds.
        addedAt: Math.floor((NOW - l.added * DAY) / 1000),
        syncedAt: 0,
      })),
    )
    .run();
  // Alice likes comedies, and has already seen one of the new arrivals.
  watched("200", 30);
  watched("201", 20);
  watched("103", 1);
});

describe("new-for-you", () => {
  it("offers each person what arrived in the window that they haven't seen, in their order", async () => {
    await run(testContext().ctx, {});

    const [alices, ...others] = rowsOf("alice");
    assert.equal(others.length, 0);
    assert.equal(alices.title, personalRowTitle("New For You", "alice"));
    assert.equal(displayTitle(alices.title), "New For You");
    assert.deepEqual(alices.labels, [NEW_FOR_YOU_LABEL, "User:alice"]);
    // Her comedy first; then the rest newest first. Not what she's seen, not the 90-day-old arrival.
    assert.deepEqual(alices.memberKeys, ["100", "101", "102"]);
    assert.equal(alices.summary, "Added since 20 September, in the order we think you'll like them.");

    // Bob has no history: newest first, and the one Alice saw is new to him.
    assert.deepEqual(rowsOf("bob")[0].memberKeys, ["101", "103", "100", "102"]);
  });

  it("edits the row in place as titles arrive and are watched", async () => {
    await run(testContext().ctx, { minItems: 2 });
    const [first] = rowsOf("alice");
    watched("100", 0);
    await run(testContext().ctx, { minItems: 2 });
    const [second] = rowsOf("alice");
    assert.equal(second.ratingKey, first.ratingKey);
    // Her comedy is watched; nothing left in her genres, so newest first.
    assert.deepEqual(second.memberKeys, ["101", "102"]);
    assert.equal(plex.journal.pinned.length, 2, "pinned once each, on creation");
  });

  it("removes the row when fewer than the minimum are new to them", async () => {
    await run(testContext().ctx, {});
    await run(testContext().ctx, { minItems: 4 });
    assert.equal(rowsOf("alice").length, 0, "three new to Alice");
    assert.equal(rowsOf("bob").length, 1, "four new to Bob");
  });

  it("a wider window reaches older arrivals", async () => {
    await run(testContext().ctx, { windowDays: 120 });
    assert.ok(rowsOf("alice")[0].memberKeys.includes("104"));
  });

  it("takes the row away when the person said it wasn't for them, and the teardown removes only its own", async () => {
    await run(testContext().ctx, {});
    db.insert(userPreferences)
      .values({ userId: 10, preferences: { excludedCollections: ["New For You"] }, optedIn: 1, updatedAt: NOW })
      .run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);

    plex.collections.set("9999", {
      ratingKey: "9999",
      title: "Other",
      sectionId: "1",
      labels: ["PickItBackUp"],
      memberKeys: [],
    });
    await remove(testContext().ctx);
    assert.deepEqual(
      [...plex.collections.values()].map((r) => r.ratingKey),
      ["9999"],
    );
  });
});
