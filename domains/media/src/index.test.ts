/**
 * `syncMedia` walks the whole library on every run, so "what's new" has to be
 * answered without a per-item query and without announcing the library itself
 * the first time it is indexed. Both are easy to get wrong in ways that only
 * show up on somebody else's 50,000-item server.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-media-test-");

const { db, events, mediaItems } = await import("@tinkerbell/db");
const { syncMedia } = await import("./index.ts");
const { createPlexClient } = await import("@tinkerbell/plex");

type PlexClient = ReturnType<typeof createPlexClient>;

const SECTION = { key: "1", title: "Movies", type: "movie" };

interface FakeItem {
  ratingKey: string;
  title: string;
  year?: number;
  Genre?: Array<{ tag: string }>;
  rating?: number;
  audienceRating?: number;
  contentRating?: string;
  duration?: number;
  Media?: Array<{ bitrate?: number; Part?: Array<{ size?: number }> }>;
}

/**
 * The narrow slice of the client `syncMedia` uses. A real client here would be
 * testing the HTTP layer, which has its own tests.
 */
function fakeClient(items: FakeItem[]): PlexClient {
  return {
    async *allItems() {
      for (const item of items) {
        yield { item: { ...item, type: "movie", addedAt: 1_700_000_000 }, totalSize: items.length };
      }
    },
  } as unknown as PlexClient;
}

function addedEvents() {
  return db
    .select()
    .from(events)
    .all()
    .filter((e) => e.type === "media.added");
}

beforeEach(() => {
  db.delete(mediaItems).run();
  db.delete(events).run();
});

describe("media.added", () => {
  test("says nothing on a library's first sync", async () => {
    // Every item is technically new. Announcing an entire library on the run
    // that first indexed it is noise, not news.
    await syncMedia(
      fakeClient([
        { ratingKey: "1", title: "A" },
        { ratingKey: "2", title: "B" },
      ]),
      [SECTION],
    );
    assert.equal(addedEvents().length, 0);
  });

  test("announces only what wasn't there on a later sync", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A" }]), [SECTION]);
    db.delete(events).run();

    await syncMedia(
      fakeClient([
        { ratingKey: "1", title: "A" },
        { ratingKey: "2", title: "B", year: 1999 },
      ]),
      [SECTION],
    );

    const fired = addedEvents();
    assert.equal(fired.length, 1);
    assert.match(fired[0].message, /1 new item/);
    assert.match(fired[0].message, /B \(1999\)/);
    assert.doesNotMatch(fired[0].message, /: A/);
  });

  test("a sync that finds nothing new says nothing", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A" }]), [SECTION]);
    db.delete(events).run();
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A" }]), [SECTION]);
    assert.equal(addedEvents().length, 0);
  });

  test("a season drop is one event with a sample, not one event per file", async () => {
    await syncMedia(fakeClient([{ ratingKey: "seed", title: "Seed" }]), [SECTION]);
    db.delete(events).run();

    const many = Array.from({ length: 30 }, (_, i) => ({ ratingKey: `n${i}`, title: `New ${i}` }));
    await syncMedia(fakeClient([{ ratingKey: "seed", title: "Seed" }, ...many]), [SECTION]);

    const fired = addedEvents();
    assert.equal(fired.length, 1);
    assert.match(fired[0].message, /30 new item/);
    assert.match(fired[0].message, /and 25 more/);
    assert.equal((fired[0].metadata as { count: number }).count, 30);
  });

  test("the returned stats list what was added", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A" }]), [SECTION]);
    const stats = await syncMedia(
      fakeClient([
        { ratingKey: "1", title: "A" },
        { ratingKey: "2", title: "B" },
      ]),
      [SECTION],
    );
    assert.deepEqual(
      stats.added.map((i) => i.ratingKey),
      ["2"],
    );
  });
});

describe("taste columns", () => {
  test("genres, rating, certificate and runtime are stored from the listing", async () => {
    await syncMedia(
      fakeClient([
        {
          ratingKey: "1",
          title: "A",
          Genre: [{ tag: "Sci-Fi" }, { tag: "Drama" }],
          rating: 8.2,
          contentRating: "15",
          duration: 7_200_000,
        },
      ]),
      [SECTION],
    );

    const row = db.select().from(mediaItems).all()[0];
    assert.deepEqual(row.genres, ["Sci-Fi", "Drama"]);
    assert.equal(row.rating, 8.2);
    assert.equal(row.contentRating, "15");
    assert.equal(row.durationMs, 7_200_000);
  });

  test("audience rating stands in when there's no critic rating", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A", audienceRating: 7.1 }]), [SECTION]);
    assert.equal(db.select().from(mediaItems).all()[0].rating, 7.1);
  });

  test("an item with no genres stores null rather than an empty list", async () => {
    // Downstream, "Plex told us nothing" and "Plex told us none" must both
    // mean "don't exclude this item", so they collapse to one value here.
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A" }]), [SECTION]);
    assert.equal(db.select().from(mediaItems).all()[0].genres, null);
  });
});

/**
 * The size column exists so a deletion queue can say what it frees, which
 * makes "wrong but plausible" the expensive failure mode: a show counted as
 * 0 B silently shrinks a total that somebody is about to make a decision on.
 */
describe("file size", () => {
  test("sums every part of every version, not just the first", async () => {
    await syncMedia(
      fakeClient([
        {
          ratingKey: "1",
          title: "Two versions",
          Media: [{ Part: [{ size: 1000 }] }, { Part: [{ size: 250 }, { size: 250 }] }],
        },
      ]),
      [SECTION],
    );
    const row = db.select().from(mediaItems).all()[0];
    assert.equal(row.fileSize, 1500);
  });

  test("an item Plex reports no media for stores null, not zero", async () => {
    // The show case: the files belong to its episodes, and a 0 here would be
    // added up by every storage total as though the show occupied nothing.
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A show" }]), [SECTION]);
    const row = db.select().from(mediaItems).all()[0];
    assert.equal(row.fileSize, null);
  });

  test("a version with no size at all stores null rather than zero", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "Sizeless", Media: [{ Part: [{}] }] }]), [SECTION]);
    const row = db.select().from(mediaItems).all()[0];
    assert.equal(row.fileSize, null);
  });

  test("bitrate comes from the first version", async () => {
    await syncMedia(fakeClient([{ ratingKey: "1", title: "A", Media: [{ bitrate: 8000, Part: [{ size: 10 }] }] }]), [
      SECTION,
    ]);
    const row = db.select().from(mediaItems).all()[0];
    assert.equal(row.bitrate, 8000);
  });
});

/**
 * A show row carries no files, so the only honest size for one is the sum of
 * its episodes. The failure that matters here is a *plausible* number: a show
 * credited with 0 B, or with only the episodes Plex happened to size, feeds a
 * storage total somebody reads as the truth.
 */
describe("show sizes", () => {
  const SHOW_SECTION = { key: "2", title: "TV Shows", type: "show" };

  function fakeShowClient(
    shows: FakeItem[],
    sizes: Record<string, { bytes: number; episodes: number; unsized: number }>,
    onShowSizes?: (sectionId: string) => void,
  ): PlexClient {
    return {
      async *allItems() {
        for (const item of shows) {
          yield { item: { ...item, type: "show", addedAt: 1_700_000_000 }, totalSize: shows.length };
        }
      },
      async showSizes(sectionId: string) {
        onShowSizes?.(sectionId);
        return new Map(Object.entries(sizes));
      },
    } as unknown as PlexClient;
  }

  test("a show is credited with the bytes of its episodes", async () => {
    await syncMedia(
      fakeShowClient([{ ratingKey: "s1", title: "A show" }], { s1: { bytes: 900, episodes: 3, unsized: 0 } }),
      [SHOW_SECTION],
    );
    assert.equal(db.select().from(mediaItems).all()[0].fileSize, 900);
  });

  test("a show whose every episode is sizeless stays unknown, not zero", async () => {
    await syncMedia(
      fakeShowClient([{ ratingKey: "s1", title: "A show" }], { s1: { bytes: 0, episodes: 4, unsized: 4 } }),
      [SHOW_SECTION],
    );
    assert.equal(db.select().from(mediaItems).all()[0].fileSize, null);
  });

  test("a partially sized show reports what is known", async () => {
    // Short of the truth, but the direction is right and the panel says how
    // many items it couldn't account for.
    await syncMedia(
      fakeShowClient([{ ratingKey: "s1", title: "A show" }], { s1: { bytes: 500, episodes: 4, unsized: 2 } }),
      [SHOW_SECTION],
    );
    assert.equal(db.select().from(mediaItems).all()[0].fileSize, 500);
  });

  test("a failed episode walk still indexes the library", async () => {
    // The index is the job; the size is a nicety. Losing a whole TV section's
    // rows because one extra listing timed out would be a bad trade.
    const client = {
      async *allItems() {
        yield { item: { ratingKey: "s1", title: "A show", type: "show" }, totalSize: 1 };
      },
      async showSizes() {
        throw new Error("boom");
      },
    } as unknown as PlexClient;
    const stats = await syncMedia(client, [SHOW_SECTION]);
    assert.equal(stats.synced, 1);
    assert.equal(db.select().from(mediaItems).all()[0].fileSize, null);
  });

  test("movie sections are not walked twice", async () => {
    // The episode walk is a second pass over the whole library. A movie
    // library's sizes are already in the listing, so paying for it there would
    // double every sync for nothing.
    let called = false;
    await syncMedia(
      fakeShowClient([{ ratingKey: "1", title: "A film", Media: [{ Part: [{ size: 10 }] }] }], {}, () => {
        called = true;
      }),
      [SECTION],
    );
    assert.equal(called, false);
  });
});
