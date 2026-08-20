import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMockArr } from "./test-support.ts";
import { createSonarrClient, hasFile, capabilitiesFor } from "./index.ts";
import type { SonarrSeries } from "./types.ts";

const SERIES = {
  id: 3,
  title: "The Wire",
  year: 2002,
  tvdbId: 79126,
  imdbId: "tt0306414",
  monitored: true,
  qualityProfileId: 4,
  // v3-only, unmodelled by this client, and the field whose loss would be
  // invisible for weeks. See the round-trip test below.
  languageProfileId: 2,
  seasons: [
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: true },
  ],
  statistics: { episodeCount: 60, episodeFileCount: 60 },
};

describe("sonarr library", () => {
  let mock: ReturnType<typeof createMockArr>;
  let url: string;

  beforeEach(async () => {
    mock = createMockArr();
    url = await mock.start();
  });
  afterEach(() => mock.stop());

  const client = () => createSonarrClient({ url, apiKey: "k" });

  it("reads the whole library", async () => {
    mock.on("GET /api/v3/series", () => ({ body: [SERIES] }));
    const all = await client().allSeries();

    assert.equal(all.length, 1);
    assert.equal(all[0].title, "The Wire");
  });

  /**
   * Sonarr has no `hasFile`. Presence is "any episode on disk", and getting
   * this wrong makes every "what am I missing" query wrong.
   */
  describe("hasFile", () => {
    it("is true when any episode is on disk", () => {
      assert.equal(hasFile({ statistics: { episodeFileCount: 1 } } as SonarrSeries), true);
    });

    it("is false for a series with no files", () => {
      assert.equal(hasFile({ statistics: { episodeFileCount: 0 } } as SonarrSeries), false);
    });

    it("is false when Sonarr reported no statistics at all", () => {
      assert.equal(hasFile({} as SonarrSeries), false);
    });
  });

  // Unlike Radarr there is no `GET /series?tvdbId=` filter, so every lookup
  // walks the list. Pinned because it is the reason the mirror indexes tvdb_id.
  it("walks the whole list to resolve a tvdb id", async () => {
    mock.on("GET /api/v3/series", () => ({ body: [SERIES] }));

    const found = await client().findByExternalId("tvdb:79126");
    assert.equal(found?.id, 3);
    assert.equal(mock.to("/api/v3/series")[0].params.tvdbId, undefined);
  });

  describe("updateSeries", () => {
    it("re-reads before writing", async () => {
      mock.on("GET /api/v3/series/3", () => ({ body: SERIES }));
      mock.on("PUT /api/v3/series/3", (req) => ({ body: req.body }));

      await client().setMonitored(3, false);

      assert.deepEqual(
        mock.requests.map((r) => `${r.method} ${r.path}`),
        ["GET /api/v3/series/3", "PUT /api/v3/series/3"],
      );
    });

    /**
     * The Sonarr-specific clobber. A PUT built from a stale or partial record
     * drops `languageProfileId`, silently resetting a v3 series to the default
     * language profile — which nobody notices until something downloads in the
     * wrong language.
     */
    it("preserves languageProfileId, which v3 nulls if omitted", async () => {
      mock.on("GET /api/v3/series/3", () => ({ body: SERIES }));
      mock.on("PUT /api/v3/series/3", (req) => ({ body: req.body }));

      await client().setMonitored(3, false);

      const put = mock.to("/api/v3/series/3")[1].body as Record<string, unknown>;
      assert.equal(put.languageProfileId, 2);
    });
  });

  /**
   * A season has no id and no endpoint of its own, so monitoring one is a
   * whole-series PUT with a single array element flipped — the operation the
   * mutator signature exists to make safe.
   */
  describe("setSeasonMonitored", () => {
    it("flips only the named season", async () => {
      mock.on("GET /api/v3/series/3", () => ({ body: SERIES }));
      mock.on("PUT /api/v3/series/3", (req) => ({ body: req.body }));

      await client().setSeasonMonitored(3, 2, false);

      const put = mock.to("/api/v3/series/3")[1].body as { seasons: Array<Record<string, unknown>> };
      assert.deepEqual(put.seasons, [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: false },
      ]);
    });
  });

  it("prefers the episode monitor endpoint over a series PUT", async () => {
    mock.on("PUT /api/v3/episode/monitor", () => ({ body: undefined }));

    await client().setEpisodesMonitored([11, 12], false);

    assert.equal(mock.requests.length, 1);
    assert.deepEqual(mock.to("/api/v3/episode/monitor")[0].body, { episodeIds: [11, 12], monitored: false });
  });

  it("sends Sonarr's monitor-mode add options, not Radarr's", async () => {
    mock.on("POST /api/v3/series", () => ({ status: 201, body: { id: 5 } }));

    await client().addSeries({ ...SERIES, raw: SERIES } as never, {
      qualityProfileId: 4,
      rootFolderPath: "/tv",
      monitor: true,
      searchOnAdd: true,
      monitorMode: "firstSeason",
    });

    const body = mock.to("/api/v3/series")[0].body as Record<string, unknown>;
    assert.deepEqual(body.addOptions, {
      monitor: "firstSeason",
      searchForMissingEpisodes: true,
      searchForCutoffUnmetEpisodes: false,
    });
  });

  it("uses Sonarr's spelling of the exclusion flag on delete", async () => {
    mock.on("DELETE /api/v3/series/3", () => ({ status: 200, body: undefined }));

    await client().deleteSeries(3, { deleteFiles: true, addImportExclusion: true });

    assert.deepEqual(mock.to("/api/v3/series/3")[0].params, {
      deleteFiles: "true",
      addImportListExclusion: "true",
    });
  });

  it("returns episodes, not series, from wanted/missing", async () => {
    mock.on("GET /api/v3/wanted/missing", () => ({
      body: { page: 1, pageSize: 50, totalRecords: 1, records: [{ id: 1, seriesId: 3, seasonNumber: 1 }] },
    }));

    const page = await client().wantedMissing();
    assert.equal(page.records[0].seasonNumber, 1);
    assert.equal(mock.to("/api/v3/wanted/missing")[0].params.includeSeries, "true");
  });
});

/**
 * The v3/v4 boundary moved two whole settings concepts in opposite
 * directions, which is why every branch must ask about a capability rather
 * than about the service.
 */
describe("sonarr capabilities", () => {
  it("gives v3 language profiles and no custom formats", () => {
    const caps = capabilitiesFor("3.0.10.1567");
    assert.ok(caps.includes("languageProfiles"));
    assert.ok(!caps.includes("customFormats"));
  });

  it("gives v4 custom formats and no language profiles", () => {
    const caps = capabilitiesFor("4.0.1.929");
    assert.ok(caps.includes("customFormats"));
    assert.ok(!caps.includes("languageProfiles"));
  });

  // A fresh install is far likelier than a decade-old one, and a settings
  // section that errors is more legible than one that silently isn't there.
  it("treats an unknown version as modern", () => {
    assert.ok(capabilitiesFor("").includes("customFormats"));
  });
});
