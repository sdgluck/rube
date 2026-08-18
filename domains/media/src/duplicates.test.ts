import { recommendKeeper } from "@tinkerbell/domain.media";
/**
 * A duplicate finder is asking someone to delete a file on its say-so, so the
 * two things that matter are that it never groups things that aren't the same
 * (a remake shares a title with its original) and that it never recommends a
 * keeper it cannot justify.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { mediaItems } from "@tinkerbell/db";
import { MediaToken } from "@tinkerbell/domain.media";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { findDuplicates } = c.resolve(MediaToken);

const T0 = 1_700_000_000;

function seed(row: {
  ratingKey: string;
  title: string;
  year?: number | null;
  sectionId?: string;
  videoResolution?: string | null;
  fileSize?: number | null;
  versionCount?: number;
  type?: string;
}): void {
  db.insert(mediaItems)
    .values({
      ratingKey: row.ratingKey,
      sectionId: row.sectionId ?? "1",
      sectionTitle: row.sectionId === "2" ? "TV Shows" : "Movies",
      title: row.title,
      year: row.year ?? null,
      type: row.type ?? "movie",
      addedAt: T0,
      videoResolution: row.videoResolution ?? null,
      fileSize: row.fileSize ?? null,
      versionCount: row.versionCount ?? 1,
      syncedAt: Date.now(),
    })
    .run();
}

const item = (over: Partial<Parameters<typeof recommendKeeper>[0][number]> = {}) => ({
  ratingKey: "1",
  title: "A film",
  year: 2001,
  sectionTitle: "Movies",
  videoResolution: null,
  videoCodec: null,
  fileSize: null,
  bitrate: null,
  versionCount: 1,
  addedAt: T0,
  ...over,
});

beforeEach(() => {
  db.delete(mediaItems).run();
});

describe("recommendKeeper", () => {
  test("prefers the higher resolution", () => {
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "1080", fileSize: 9_000 }),
      item({ ratingKey: "b", videoResolution: "4k", fileSize: 1_000 }),
    ]);
    // Deliberately the smaller file: a bigger 1080p is still not the 4K one.
    assert.equal(keeper.ratingKey, "b");
    assert.match(keeper.reason, /resolution/i);
  });

  test("falls back to the largest file at equal resolution", () => {
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "1080", fileSize: 4_000 }),
      item({ ratingKey: "b", videoResolution: "1080", fileSize: 9_000 }),
    ]);
    assert.equal(keeper.ratingKey, "b");
    assert.match(keeper.reason, /largest/i);
  });

  test("recommends nothing when the copies are indistinguishable", () => {
    // "Keep this one" with no reason behind it is worse than "you decide".
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "1080", fileSize: 5_000 }),
      item({ ratingKey: "b", videoResolution: "1080", fileSize: 5_000 }),
    ]);
    assert.equal(keeper.ratingKey, null);
    assert.match(keeper.reason, /nothing separates/i);
  });

  test("recommends nothing when no size is known and resolutions tie", () => {
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "1080" }),
      item({ ratingKey: "b", videoResolution: "1080" }),
    ]);
    assert.equal(keeper.ratingKey, null);
  });

  test("an empty group has no keeper", () => {
    assert.equal(recommendKeeper([]).ratingKey, null);
  });
});

describe("findDuplicates", () => {
  test("groups two entries sharing a title and year in one library", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022, fileSize: 1_000 });
    seed({ ratingKey: "b", title: "Hollow Mercury", year: 2022, fileSize: 4_000, videoResolution: "4k" });

    const { groups } = findDuplicates();
    const entries = groups.filter((g) => g.kind === "entries");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].items.length, 2);
    assert.equal(entries[0].keeperRatingKey, "b");
  });

  test("a remake is not a duplicate of its original", () => {
    // Same title, different year. Grouping these is the false positive that
    // would get the whole page distrusted.
    seed({ ratingKey: "a", title: "The Thing", year: 1982 });
    seed({ ratingKey: "b", title: "The Thing", year: 2011 });
    assert.deepEqual(findDuplicates().groups, []);
  });

  test("the same title in two libraries is not a duplicate", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022, sectionId: "1" });
    seed({ ratingKey: "b", title: "Hollow Mercury", year: 2022, sectionId: "2" });
    assert.deepEqual(findDuplicates().groups, []);
  });

  test("titles are matched regardless of case", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022 });
    seed({ ratingKey: "b", title: "HOLLOW MERCURY", year: 2022 });
    assert.equal(findDuplicates().groups.length, 1);
  });

  test("an item with several versions is reported on its own", () => {
    seed({ ratingKey: "a", title: "The Salt Horizon", year: 2019, versionCount: 2, fileSize: 8_000 });
    const { groups } = findDuplicates();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, "versions");
    // No per-version sizes exist in the index, so no figure is claimed.
    assert.equal(groups[0].reclaimable, 0);
  });

  test("reclaimable counts everything but the keeper", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022, fileSize: 1_000 });
    seed({ ratingKey: "b", title: "Hollow Mercury", year: 2022, fileSize: 4_000, videoResolution: "4k" });
    const { reclaimable } = findDuplicates();
    assert.equal(reclaimable, 1_000);
  });

  test("nothing is claimed as reclaimable when no keeper is recommended", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022, fileSize: 5_000, videoResolution: "1080" });
    seed({ ratingKey: "b", title: "Hollow Mercury", year: 2022, fileSize: 5_000, videoResolution: "1080" });
    assert.equal(findDuplicates().reclaimable, 0);
  });

  test("a library with no duplicates reports none", () => {
    seed({ ratingKey: "a", title: "Hollow Mercury", year: 2022 });
    seed({ ratingKey: "b", title: "Neon Cartographer", year: 2021 });
    assert.deepEqual(findDuplicates().groups, []);
  });
});

describe("resolution labels Plex doesn't normalise", () => {
  test("a numeric height beats an unknown resolution", () => {
    // Plex usually reports `4k`, but not always. An unrecognised label used to
    // rank 0 — equal to "no idea at all" — so a `2160` copy tied with a copy of
    // unknown resolution, and the group fell through to the size tie-break or to
    // "nothing separates these copies".
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: null, fileSize: 9_000 }),
      item({ ratingKey: "b", videoResolution: "2160", fileSize: 1_000 }),
    ]);
    assert.equal(keeper.ratingKey, "b");
    assert.match(keeper.reason, /resolution/i);
  });

  test("a numeric height sits in the right tier against a named one", () => {
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "1080", fileSize: 9_000 }),
      item({ ratingKey: "b", videoResolution: "2160", fileSize: 1_000 }),
    ]);
    assert.equal(keeper.ratingKey, "b");
  });

  test("a label that isn't a height at all is still unknown", () => {
    const keeper = recommendKeeper([
      item({ ratingKey: "a", videoResolution: "mystery", fileSize: 9_000 }),
      item({ ratingKey: "b", videoResolution: "wat", fileSize: 1_000 }),
    ]);
    // Nothing to choose on resolution, so size decides.
    assert.equal(keeper.ratingKey, "a");
    assert.match(keeper.reason, /largest/i);
  });
});
