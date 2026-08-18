/**
 * Two library numbers that were structurally wrong rather than merely stale.
 *
 * `episodeCount` counted `type = 'episode'` rows in the media index, and there
 * are none: the sync walks a section's top-level items, so a TV library indexes
 * shows. The Shows tile therefore always read "~0 episodes each" and the library
 * split always read "100% movies", on every install, with a perfectly healthy
 * sync.
 *
 * `viewers` counted distinct `user_id`, where unknown users are all stored as 0 —
 * so every unidentified play collapsed onto one "viewer" and an item nobody was
 * named for could never rank above 1.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-stats-counts-test-");

const { db, mediaItems, playbackSessions } = await import("@tinkerbell/db");
const { getLibraryOverview, getMostWatched, getActivitySummary } = await import("./index.ts");

const NOW = Date.parse("2026-08-04T12:00:00Z");

function seedShow(ratingKey: string, leafCount: number | null): void {
  db.insert(mediaItems)
    .values({
      ratingKey,
      sectionId: "2",
      sectionTitle: "TV",
      title: `Show ${ratingKey}`,
      type: "show",
      leafCount,
      syncedAt: NOW,
    })
    .run();
}

function seedMovie(ratingKey: string): void {
  db.insert(mediaItems)
    .values({
      ratingKey,
      sectionId: "1",
      sectionTitle: "Films",
      title: `Film ${ratingKey}`,
      type: "movie",
      syncedAt: NOW,
    })
    .run();
}

let seq = 0;
function play(ratingKey: string, userId: number, at = NOW - 1000): void {
  seq++;
  db.insert(playbackSessions)
    .values({
      id: `s${seq}`,
      userId,
      username: userId === 0 ? "" : `user${userId}`,
      ratingKey,
      title: `Item ${ratingKey}`,
      type: "movie",
      startedAt: at,
      lastSeenAt: at,
    })
    .run();
}

beforeEach(() => {
  db.delete(playbackSessions).run();
  db.delete(mediaItems).run();
  seq = 0;
});

describe("episodeCount", () => {
  test("sums the episode counts of the shows, not a row type that never exists", () => {
    seedShow("s1", 24);
    seedShow("s2", 10);
    seedMovie("m1");
    const overview = getLibraryOverview();
    assert.equal(overview.showCount, 2);
    assert.equal(overview.movieCount, 1);
    assert.equal(overview.episodeCount, 34);
  });

  test("a show Plex never counted contributes nothing rather than breaking the sum", () => {
    seedShow("s1", 24);
    seedShow("s2", null);
    assert.equal(getLibraryOverview().episodeCount, 24);
  });

  test("a movie-only library reports no episodes", () => {
    seedMovie("m1");
    assert.equal(getLibraryOverview().episodeCount, 0);
  });
});

describe("viewers", () => {
  test("counts the people Plex named, and not the unknown-user sentinel", () => {
    seedMovie("m1");
    // Forty plays by nobody Plex could identify is not one viewer.
    for (let i = 0; i < 4; i++) play("m1", 0);
    const [item] = getMostWatched({ since: 0 });
    assert.equal(item.plays, 4);
    assert.equal(item.viewers, 0, "unidentified plays are not a viewer count");
  });

  test("distinct named users still count once each, however often they rewatch", () => {
    seedMovie("m1");
    play("m1", 7);
    play("m1", 7);
    play("m1", 8);
    play("m1", 0);
    const [item] = getMostWatched({ since: 0 });
    assert.equal(item.plays, 4);
    assert.equal(item.viewers, 2);
  });

  test("the weekly active-user tile ignores the sentinel too", () => {
    seedMovie("m1");
    play("m1", 0);
    play("m1", 0);
    assert.equal(getActivitySummary(NOW).activeUsersWeek, 0);
    play("m1", 7);
    assert.equal(getActivitySummary(NOW).activeUsersWeek, 1);
  });

  test("the year comes from the library index", () => {
    // The field existed on the type and was rendered by the panel; nothing ever
    // populated it, so the "(1999)" suffix was dead code.
    db.insert(mediaItems)
      .values({
        ratingKey: "m9",
        sectionId: "1",
        sectionTitle: "Films",
        title: "The Matrix",
        type: "movie",
        year: 1999,
        syncedAt: NOW,
      })
      .run();
    play("m9", 7);
    assert.equal(getMostWatched({ since: 0 })[0].year, 1999);
  });
});
