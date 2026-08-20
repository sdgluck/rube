import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { presenceBadge, canAdd, holdingLink, addDefaults, type DiscoverResult } from "./discover.ts";

const base: DiscoverResult = {
  tmdbId: 603,
  mediaType: "movie",
  service: "radarr",
  title: "The Matrix",
  year: 1999,
  overview: "",
  posterPath: null,
  inArr: [],
  plexRatingKey: null,
};

const holding = (over: Partial<DiscoverResult["inArr"][number]> = {}) => ({
  instanceId: "radarr",
  arrId: 7,
  monitored: true,
  hasFile: true,
  ...over,
});

describe("presenceBadge", () => {
  test("Plex ends the question", () => {
    assert.deepEqual(presenceBadge({ inArr: [holding()], plexRatingKey: "1" }), { label: "In Plex", tone: "ok" });
  });

  test("nothing held means no chip — the card gets an Add button", () => {
    assert.equal(presenceBadge({ inArr: [], plexRatingKey: null }), null);
  });

  test("held and on disk names the instance", () => {
    assert.deepEqual(
      presenceBadge({ inArr: [holding()], plexRatingKey: null }, () => "Radarr 4K"),
      {
        label: "In Radarr 4K",
        tone: "ok",
      },
    );
  });

  test("monitored with no file is coming, not missing", () => {
    assert.deepEqual(presenceBadge({ inArr: [holding({ hasFile: false })], plexRatingKey: null }), {
      label: "Wanted in radarr",
      tone: "running",
    });
  });

  test("unmonitored with no file is neither", () => {
    assert.deepEqual(presenceBadge({ inArr: [holding({ hasFile: false, monitored: false })], plexRatingKey: null }), {
      label: "Unmonitored in radarr",
      tone: "advisory",
    });
  });

  test("two instances is counted, not named — there is no single answer", () => {
    assert.deepEqual(
      presenceBadge({ inArr: [holding(), holding({ instanceId: "radarr-4k", arrId: 9 })], plexRatingKey: null }),
      { label: "In 2 instances", tone: "advisory" },
    );
  });
});

describe("canAdd", () => {
  test("offered when nothing holds it", () => {
    assert.equal(canAdd({ inArr: [] }, true), true);
  });

  test("not offered when an *Arr already has it", () => {
    assert.equal(canAdd({ inArr: [holding()] }, true), false);
  });

  test("not offered when the service isn't configured", () => {
    assert.equal(canAdd({ inArr: [] }, false), false);
  });

  /** A film Plex has that no *Arr manages is exactly what you might want to start managing. */
  test("Plex alone does not block adding", () => {
    assert.equal(canAdd({ inArr: [] }, true), true);
  });
});

describe("holdingLink", () => {
  test("links straight to the record when one instance holds it", () => {
    assert.equal(holdingLink({ ...base, inArr: [holding()] }), "/arrs/radarr/movies/7");
  });

  test("uses the series path for a show", () => {
    assert.equal(
      holdingLink({ ...base, mediaType: "tv", inArr: [holding({ instanceId: "sonarr", arrId: 12 })] }),
      "/arrs/sonarr/series/12",
    );
  });

  test("two instances has no single destination", () => {
    assert.equal(holdingLink({ ...base, inArr: [holding(), holding({ arrId: 9 })] }), null);
  });
});

describe("addDefaults", () => {
  test("first profile, first accessible folder", () => {
    assert.deepEqual(
      addDefaults(
        [{ id: 4 }, { id: 7 }],
        [
          { path: "/broken", accessible: false },
          { path: "/data/media", accessible: true },
        ],
      ),
      { qualityProfileId: 4, rootFolderPath: "/data/media" },
    );
  });

  /** An *Arr that reports no accessible folder at all still has to be pickable. */
  test("falls back to the first folder when none is accessible", () => {
    assert.deepEqual(addDefaults([{ id: 4 }], [{ path: "/broken", accessible: false }]), {
      qualityProfileId: 4,
      rootFolderPath: "/broken",
    });
  });

  test("nothing loaded yet is nulls, not a guess", () => {
    assert.deepEqual(addDefaults(undefined, undefined), { qualityProfileId: null, rootFolderPath: null });
  });
});
