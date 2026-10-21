/**
 * Pick It Back Up end to end, through real HTTP to a mock Plex that serves
 * shows and their episode lists.
 *
 * What's protected: a row holds only shows someone actually stopped — not
 * ones they're still watching, sampled once, or finished — and it is edited
 * in place while there's something in it and removed when there isn't.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { displayTitle, noopCheckpoint, personalRowTitle, ConfigStoreToken, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, mediaItems, playbackSessions, plexUsers, userPreferences } from "@rube/db";
import { startMockPlex, type MockPlex, type MockShow } from "../../test-support/mock-plex-server.ts";
import { createPickItBackUpCommand, PIBU_LABEL } from "./index.ts";
import { createPibuRemoveCommand } from "../pibu-remove.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createPickItBackUpCommand(services);
const { run: remove } = createPibuRemoveCommand(services);

const DAY = 86_400_000;

function show(ratingKey: string, title: string, episodes: number, season = 1): MockShow {
  return {
    ratingKey,
    title,
    sectionId: "2",
    episodes: Array.from({ length: episodes }, (_, i) => ({
      season,
      episode: i + 1,
      title: `${title} ${i + 1}`,
      file: `/tv/${title}/Season ${season}/${i + 1}.mkv`,
    })),
  };
}
const SHOWS = [show("500", "Andor", 6), show("501", "Severance", 4), show("502", "The Bear", 3)];

let plex: MockPlex;
let sessionId = 0;

/** A play of episode `index` (0-based) of `showKey`, as the mock numbers its leaves. */
function play(userId: number, showKey: string, index: number, daysAgo: number, completion = 1) {
  db.insert(playbackSessions)
    .values({
      id: `p${sessionId++}`,
      userId,
      username: userId === 10 ? "alice" : "bob",
      ratingKey: `${showKey}-${index}`,
      grandparentRatingKey: showKey,
      title: `${showKey}-${index}`,
      type: "episode",
      startedAt: Date.now() - daysAgo * DAY,
      lastSeenAt: Date.now(),
      completionPct: completion,
    })
    .run();
}

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
    items: [],
    shows: SHOWS,
  });
});
after(async () => plex?.close());

beforeEach(() => {
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  for (const table of [plexUsers, playbackSessions, mediaItems, userPreferences]) db.delete(table).run();

  db.insert(plexUsers)
    .values([
      { userId: 10, username: "alice", label: "alice", syncedAt: 0 },
      { userId: 11, username: "bob", label: "bob", syncedAt: 0 },
    ])
    .run();
  db.insert(mediaItems)
    .values(
      SHOWS.map((s) => ({
        ratingKey: s.ratingKey,
        sectionId: "2",
        sectionTitle: "TV",
        title: s.title,
        type: "show",
        leafCount: s.episodes.length,
        syncedAt: 0,
      })),
    )
    .run();

  // Alice: three episodes of Andor three weeks ago, then nothing — stopped.
  for (const i of [0, 1, 2]) play(10, "500", i, 21);
  // One episode of Severance: a sampled pilot, not a started show.
  play(10, "501", 0, 21);
  // The Bear two days ago: still being watched.
  for (const i of [0, 1]) play(10, "502", i, 2);
});

describe("pick-it-back-up", () => {
  it("builds a row of the shows someone stopped, saying where each picks up", async () => {
    const { ctx, log } = testContext();
    await run(ctx, {});

    const [row, ...others] = rowsOf("alice");
    assert.equal(others.length, 0);
    assert.equal(rowsOf("bob").length, 0, "Bob has watched nothing");
    assert.equal(row.title, personalRowTitle("Pick It Back Up", "alice"));
    assert.equal(displayTitle(row.title), "Pick It Back Up");
    assert.equal(row.sectionId, "2", "in the TV library, not Films");
    assert.deepEqual(row.labels, [PIBU_LABEL, "User:alice"]);
    assert.deepEqual(row.memberKeys, ["500"]);
    assert.equal(row.summary, "Shows you started and haven't been back to. Next up: Andor S1E4.");
    assert.deepEqual(plex.journal.pinHomes, [
      { ratingKey: row.ratingKey, own: false, shared: true, recommended: false },
    ]);
    assert.match(log.join("\n"), /Andor \(next S1E4, 3 left\)/);
  });

  it("edits the row in place as shows come and go", async () => {
    await run(testContext().ctx, {});
    const [first] = rowsOf("alice");

    // A second Severance episode makes it a started show.
    play(10, "501", 1, 20);
    await run(testContext().ctx, {});
    const [second, ...more] = rowsOf("alice");
    assert.equal(more.length, 0);
    assert.equal(second.ratingKey, first.ratingKey, "same collection, so it keeps its pin and place");
    assert.deepEqual([...second.memberKeys].sort(), ["500", "501"]);
    assert.equal(plex.journal.pinned.length, 1, "pinned once, on creation");
  });

  it("removes the row once there's nothing left to pick up", async () => {
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 1);

    // She went back to Andor yesterday: still watching, so not stopped.
    play(10, "500", 3, 1);
    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.equal(rowsOf("alice").length, 0);
    assert.match(log.join("\n"), /nothing left in it/);
  });

  it("leaves out a show they finished, and one they gave up on long ago", async () => {
    db.delete(playbackSessions).run();
    for (const i of [0, 1, 2]) play(10, "502", i, 30); // The Bear, all three: caught up.
    for (const i of [0, 1, 2]) play(10, "500", i, 500); // Andor, a year and more ago.
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);
  });

  it("takes the row away when the person said it wasn't for them", async () => {
    await run(testContext().ctx, {});
    db.insert(userPreferences)
      .values({
        userId: 10,
        preferences: { excludedCollections: ["Pick It Back Up"] },
        optedIn: 1,
        updatedAt: Date.now(),
      })
      .run();
    await run(testContext().ctx, {});
    assert.equal(rowsOf("alice").length, 0);
  });

  it("refuses a window that ends before it starts", async () => {
    await assert.rejects(run(testContext().ctx, { stallDays: 60, maxStallDays: 30 }), /has to be shorter/);
  });

  it("is torn down by its remove job, which leaves other rows alone", async () => {
    await run(testContext().ctx, {});
    plex.collections.set("9999", {
      ratingKey: "9999",
      title: "Other",
      sectionId: "2",
      labels: ["WeThinkYoudLike"],
      memberKeys: [],
    });
    await remove(testContext().ctx);
    assert.deepEqual(
      [...plex.collections.values()].map((r) => r.ratingKey),
      ["9999"],
    );
  });
});
