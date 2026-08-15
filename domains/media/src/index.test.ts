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
