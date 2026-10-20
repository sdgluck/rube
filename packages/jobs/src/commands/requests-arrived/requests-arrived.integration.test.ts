/**
 * Your Requests Are Here end to end: a mock Overseerr and a mock Plex over
 * real HTTP, the library index and play history seeded locally, the clock
 * pinned.
 *
 * What's protected: each person's row holds what *they* asked for that has
 * arrived — not someone else's request, not one still processing, not one from
 * months ago — and lets each go once they've got to it.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConfigStoreToken, displayTitle, noopCheckpoint, personalRowTitle, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, mediaItems, playbackSessions, plexUsers, userPreferences, watchState } from "@tinkerbell/db";
import { ClockToken } from "@tinkerbell/ports";
import { startMockSeerr, type MockSeerr, type MockSeerrRequest } from "@tinkerbell/test-support/seerr";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createRequestsArrivedCommand, REQUESTS_LABEL } from "./index.ts";
import { createRequestsRemoveCommand } from "../requests-remove.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const c = createTestContainer({ now: NOW });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createRequestsArrivedCommand(services, { now: c.resolve(ClockToken) });
const { run: remove } = createRequestsRemoveCommand(services);

/** Rating key, section, title, type. */
const LIBRARY = [
  { key: "100", section: "1", title: "Dune: Part Two", type: "movie" },
  { key: "101", section: "1", title: "Conclave", type: "movie" },
  { key: "102", section: "1", title: "Old Request", type: "movie" },
  { key: "500", section: "2", title: "The Bear", type: "show" },
];

function request(
  id: number,
  ratingKey: string | null,
  requestedBy: MockSeerrRequest["requestedBy"],
  arrivedDaysAgo: number,
  status = 5,
): MockSeerrRequest {
  const item = LIBRARY.find((l) => l.key === ratingKey);
  return {
    id,
    media: {
      tmdbId: 1000 + id,
      mediaType: item?.type === "show" ? "tv" : "movie",
      status,
      ratingKey,
      mediaAddedAt: ago(arrivedDaysAgo),
    },
    requestedBy,
    createdAt: ago(arrivedDaysAgo + 3),
  };
}

let plex: MockPlex;
let seerr: MockSeerr;

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

before(async () => {
  plex = await startMockPlex({
    sections: [
      { key: "1", title: "Films", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ],
    items: LIBRARY.map((l) => ({ ratingKey: l.key, title: l.title, sectionId: l.section, guids: [], labels: [] })),
  });
  seerr = await startMockSeerr();
});
after(async () => {
  await plex?.close();
  await seerr?.close();
});

beforeEach(() => {
  c.setNow(NOW);
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("global_seerr_url", seerr.origin);
  setConfig("global_seerr_api_key", seerr.apiKey);
  for (const table of [plexUsers, mediaItems, watchState, playbackSessions, userPreferences]) db.delete(table).run();
  db.insert(plexUsers)
    .values([
      { userId: 10, username: "alice", label: "alice", email: "alice@example.com", syncedAt: 0 },
      { userId: 11, username: "bob", label: "bob", syncedAt: 0 },
    ])
    .run();
  db.insert(mediaItems)
    .values(
      LIBRARY.map((l) => ({
        ratingKey: l.key,
        sectionId: l.section,
        sectionTitle: l.section === "1" ? "Films" : "TV",
        title: l.title,
        type: l.type,
        syncedAt: 0,
      })),
    )
    .run();
  // Newest first, as Overseerr serves them.
  seerr.requests = [
    request(1, "100", { plexId: 10, plexUsername: "alice" }, 1), // Alice's, by plex.tv id
    request(2, "500", { username: "alice" }, 2), // Alice's show, by name only
    request(3, "101", { plexId: 11 }, 3), // Bob's
    request(4, "101", { username: "carol" }, 3), // Nobody on the Users page
    request(5, null, { plexId: 10 }, 4, 3), // Alice's, still processing
    request(6, "102", { email: "alice@example.com" }, 90), // Alice's, months ago
  ];
});

describe("requests-arrived", () => {
  it("builds each person's own rows of what they asked for that has arrived, newest first", async () => {
    const { ctx, log } = testContext();
    await run(ctx, {});

    const alice = rowsOf("alice");
    assert.equal(alice.length, 2, "one row in Films, one in TV");
    const films = alice.find((r) => r.sectionId === "1")!;
    assert.equal(films.title, personalRowTitle("Your Requests Are Here", "alice"));
    assert.equal(displayTitle(films.title), "Your Requests Are Here");
    assert.deepEqual(films.labels, [REQUESTS_LABEL, "User:alice"]);
    assert.deepEqual(films.memberKeys, ["100"], "not the processing one, not the 90-day-old one");
    assert.equal(films.summary, "You asked for these, and they're here: Dune: Part Two.");
    assert.deepEqual(alice.find((r) => r.sectionId === "2")!.memberKeys, ["500"]);
    assert.deepEqual(rowsOf("bob")[0].memberKeys, ["101"]);
    assert.match(log.join("\n"), /Requests from carol match nobody on the Users page/);
    assert.ok(seerr.journal.every((p) => p.includes("filter=available")));
  });

  it("lets a film go once it's watched, and a show once they've started it", async () => {
    await run(testContext().ctx, {});
    const [before] = rowsOf("alice").filter((r) => r.sectionId === "1");

    db.insert(watchState)
      .values({ ratingKey: "100", userId: 10, plays: 1, completedPlays: 1, lastPlayedAt: NOW, maxCompletionPct: 1 })
      .run();
    db.insert(playbackSessions)
      .values({
        id: "p1",
        userId: 10,
        username: "alice",
        ratingKey: "500-1",
        grandparentRatingKey: "500",
        title: "System",
        type: "episode",
        startedAt: NOW - DAY,
        lastSeenAt: NOW - DAY,
      })
      .run();
    // A new arrival keeps the Films row alive, edited in place.
    seerr.requests = [request(7, "102", { plexId: 10 }, 0), ...seerr.requests];
    await run(testContext().ctx, {});

    const films = rowsOf("alice").filter((r) => r.sectionId === "1");
    assert.equal(films.length, 1);
    assert.equal(films[0].ratingKey, before.ratingKey);
    assert.deepEqual(films[0].memberKeys, ["102"]);
    assert.equal(rowsOf("alice").filter((r) => r.sectionId === "2").length, 0, "the TV row emptied and went");
  });

  it("drops an arrival older than the window, watched or not", async () => {
    c.setNow(NOW + 70 * DAY);
    await run(testContext().ctx, { maxAgeDays: 60 });
    assert.equal(rowsOf("alice").length, 0);
    assert.equal(rowsOf("bob").length, 0);
  });

  it("a play from before the show arrived doesn't count as having found it", async () => {
    db.insert(playbackSessions)
      .values({
        id: "old",
        userId: 10,
        username: "alice",
        ratingKey: "500-1",
        grandparentRatingKey: "500",
        title: "System",
        type: "episode",
        startedAt: NOW - 30 * DAY,
        lastSeenAt: NOW - 30 * DAY,
      })
      .run();
    await run(testContext().ctx, {});
    assert.deepEqual(rowsOf("alice").find((r) => r.sectionId === "2")?.memberKeys, ["500"]);
  });

  it("takes the rows away when the person said they weren't for them", async () => {
    await run(testContext().ctx, {});
    db.insert(userPreferences)
      .values({
        userId: 10,
        preferences: { excludedCollections: ["Your Requests Are Here"] },
        optedIn: 1,
        updatedAt: NOW,
      })
      .run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);
    assert.equal(rowsOf("bob").length, 1);
  });

  it("is torn down by its remove job, which leaves other rows alone", async () => {
    await run(testContext().ctx, {});
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
