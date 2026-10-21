/**
 * Unused 4K end to end, against a mock Radarr on a real port.
 *
 * Two things are pinned hardest. The candidate list must never offer a film
 * somebody may have watched in 4K — including the case where the play log
 * simply doesn't know (pruned or backfilled plays). And a swap must never
 * delete the 4K file ahead of a playable replacement: the only thing that
 * replaces it is the ManualImport of a finished 1080p download, and every
 * failure puts the original quality profile back.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createTestContainer } from "@rube/composition/test-support";
import { arrMovies, DbToken, mediaItems, playbackSessions, qualitySwaps, watchState } from "@rube/db";
import { ConfigStoreToken } from "@rube/core";
import { startMockRadarr, type MockArr } from "@rube/test-support";
import type { RadarrRelease } from "@rube/radarr";
import { chooseRelease, QualitySwapsToken } from "./index.ts";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const c = createTestContainer({ now: NOW });
after(() => c.dispose());
const db = c.resolve(DbToken);
const swaps = c.resolve(QualitySwapsToken);

const UHD = { quality: { id: 19, name: "Bluray-2160p", resolution: 2160 } };
const FHD = { quality: { id: 7, name: "Bluray-1080p", resolution: 1080 } };

let radarr: MockArr;
before(async () => {
  radarr = await startMockRadarr([
    { id: 1, title: "Heat", tmdbId: 949, monitored: true, hasFile: true, qualityProfileId: 5 },
    { id: 2, title: "Ronin", tmdbId: 8195, monitored: true, hasFile: true, qualityProfileId: 5 },
  ]);
  const { setConfig } = c.resolve(ConfigStoreToken);
  setConfig("global_radarr_url", radarr.origin);
  setConfig("global_radarr_api_key", "key");
});
after(() => radarr.close());

function film(
  ratingKey: string,
  arrId: number,
  title: string,
  opts: { resolution?: string; addedDaysAgo?: number } = {},
) {
  db.insert(mediaItems)
    .values({
      ratingKey,
      sectionId: "1",
      sectionTitle: "Movies",
      title,
      type: "movie",
      videoResolution: opts.resolution ?? "4k",
      addedAt: Math.floor((NOW - (opts.addedDaysAgo ?? 400) * DAY) / 1000),
      syncedAt: NOW,
    })
    .run();
  db.insert(arrMovies)
    .values({
      instanceId: "radarr",
      arrId,
      title,
      year: 1995,
      plexRatingKey: ratingKey,
      hasFile: true,
      qualityProfileId: 5,
      fileQuality: opts.resolution === "1080" ? "Bluray-1080p" : "Bluray-2160p",
      sizeOnDisk: 60_000_000_000,
      syncedAt: NOW,
    })
    .run();
}

let sid = 0;
function play(ratingKey: string, decision: string, opts: { counted?: boolean } = {}) {
  db.insert(playbackSessions)
    .values({
      id: `s${++sid}`,
      userId: 1,
      username: "u",
      ratingKey,
      title: ratingKey,
      type: "movie",
      decision,
      startedAt: NOW - DAY,
      lastSeenAt: NOW - DAY,
      endedAt: NOW - DAY,
    })
    .run();
  if (opts.counted !== false) bumpWatchState(ratingKey);
}

function bumpWatchState(ratingKey: string) {
  const row = db
    .select()
    .from(watchState)
    .all()
    .find((r) => r.ratingKey === ratingKey);
  if (row) {
    db.delete(watchState).run();
    db.insert(watchState)
      .values({ ...row, plays: row.plays + 1 })
      .run();
  } else {
    db.insert(watchState)
      .values({ ratingKey, userId: 1, plays: 1, lastPlayedAt: NOW - DAY })
      .run();
  }
}

const keys = () => swaps.unusedFourK().map((x) => x.ratingKey);

beforeEach(() => {
  for (const t of [mediaItems, arrMovies, playbackSessions, watchState, qualitySwaps]) db.delete(t).run();
  radarr.pipeline.releases.clear();
  radarr.pipeline.files.clear();
  radarr.pipeline.downloads.clear();
  radarr.journal.grabs.length = 0;
  radarr.journal.commands.length = 0;
  radarr.journal.puts.length = 0;
  // The mock keeps what the last test PUT; every test starts on the 4K profile.
  for (const id of [1, 2]) Object.assign(radarr.records.get(id)!, { qualityProfileId: 5 });
});

describe("who counts as unused", () => {
  test("never played, or only ever transcoded, is offered", () => {
    film("a", 1, "Never played");
    film("b", 2, "Transcoded");
    play("b", "transcode");
    play("b", "transcode");
    assert.deepEqual(keys().sort(), ["a", "b"]);
    assert.equal(swaps.unusedFourK().find((x) => x.ratingKey === "b")?.plays, 2);
  });

  test("one direct play or direct stream in 4K rules it out", () => {
    film("a", 1, "Direct play");
    film("b", 2, "Direct stream");
    play("a", "transcode");
    play("a", "directplay");
    play("b", "copy");
    assert.deepEqual(keys(), []);
  });

  test("a play the log can't account for rules it out", () => {
    // Counted in watch_state, but the session that would say how it was
    // played has been pruned — it might have been in 4K.
    film("a", 1, "Pruned history");
    bumpWatchState("a");
    // Backfilled from Plex history: no decision recorded.
    film("b", 2, "Backfilled");
    play("b", "");
    assert.deepEqual(keys(), []);
  });

  test("not 4K, or too new to have been given a chance, is left out", () => {
    film("a", 1, "1080p already", { resolution: "1080" });
    film("b", 2, "Added last week", { addedDaysAgo: 7 });
    assert.deepEqual(keys(), []);
  });
});

test("chooseRelease takes Radarr's best 1080p, ignoring only 'already have better'", () => {
  const pick = chooseRelease([
    { guid: "4k", title: "4K", quality: UHD, releaseWeight: 1 },
    { guid: "small", title: "Too small", quality: FHD, releaseWeight: 2, rejections: ["Size too small"] },
    {
      guid: "ok2",
      title: "Second",
      quality: FHD,
      releaseWeight: 4,
      rejections: ["Not an upgrade for existing movie file"],
    },
    {
      guid: "ok1",
      title: "First",
      quality: FHD,
      releaseWeight: 3,
      rejections: ["Existing file meets cutoff: Bluray-2160p"],
    },
  ] as RadarrRelease[]);
  assert.equal(pick?.guid, "ok1");
});

describe("a swap", () => {
  async function startHeat() {
    film("a", 1, "Heat");
    radarr.pipeline.files.set(1, { id: 10, movieId: 1, quality: UHD, size: 60_000_000_000 });
    radarr.pipeline.releases.set(1, [
      {
        guid: "g1",
        indexerId: 1,
        title: "Heat.1995.1080p.BluRay-GRP",
        quality: FHD,
        size: 12_000_000_000,
        releaseWeight: 1,
      },
    ]);
    const r = swaps.start({ movies: [{ instanceId: "radarr", arrMovieId: 1 }], profiles: { radarr: 4 } });
    assert.equal(r.queued, 1);
    return () => db.select().from(qualitySwaps).get()!;
  }

  test("sets the 1080p profile, grabs, waits, then imports over the 4K file", async () => {
    const row = await startHeat();
    // A second start for the same film is refused: it is no longer a candidate.
    assert.equal(swaps.start({ movies: [{ instanceId: "radarr", arrMovieId: 1 }], profiles: { radarr: 4 } }).queued, 0);

    await swaps.advanceAll();
    assert.equal(row().state, "downloading");
    assert.equal(radarr.journal.puts.at(-1)?.body.qualityProfileId, 4);
    assert.equal(radarr.journal.grabs[0].guid, "g1");
    assert.equal(radarr.pipeline.files.get(1)?.quality, UHD, "the 4K file is untouched while downloading");

    await swaps.advanceAll();
    assert.match(row().message, /Downloading — 50%/);

    radarr.pipeline.finish("DL1");
    await swaps.advanceAll();
    assert.equal(row().state, "importing");
    const [command] = radarr.journal.commands;
    assert.equal(command.name, "ManualImport");
    const [file] = command.files as Array<Record<string, unknown>>;
    assert.equal(
      file.path,
      "/downloads/Heat.1995.1080p.BluRay-GRP/Heat.1995.1080p.BluRay-GRP.mkv",
      "the film, not the sample",
    );
    assert.equal(file.downloadId, "DL1");

    await swaps.advanceAll();
    assert.equal(row().state, "done");
    assert.equal(row().toQuality, "Bluray-1080p");
    assert.match(row().message, /freed 48(\.\d+)? GB/);
  });

  test("no acceptable release puts the 4K profile back", async () => {
    const row = await startHeat();
    radarr.pipeline.releases.set(1, [{ guid: "x", title: "Tiny", quality: FHD, rejections: ["Size too small"] }]);
    await swaps.advanceAll();
    assert.equal(row().state, "failed");
    assert.match(row().message, /None of 1 1080p release/);
    assert.equal(radarr.journal.puts.at(-1)?.body.qualityProfileId, 5);
    assert.equal(radarr.journal.grabs.length, 0);
  });

  test("a failed download puts the profile back and leaves the 4K file", async () => {
    const row = await startHeat();
    await swaps.advanceAll();
    radarr.pipeline.failDownload("DL1", "Unpacking failed");
    await swaps.advanceAll();
    assert.equal(row().state, "failed");
    assert.match(row().message, /Unpacking failed/);
    assert.equal(radarr.journal.puts.at(-1)?.body.qualityProfileId, 5);
    assert.equal(radarr.pipeline.files.get(1)?.quality, UHD);
  });

  test("cancelling mid-download drops the download and restores the profile", async () => {
    const row = await startHeat();
    await swaps.advanceAll();
    const result = await swaps.cancel(row().id);
    assert.equal(result.ok, true);
    assert.equal(row().state, "cancelled");
    assert.equal(radarr.pipeline.downloads.size, 0);
    assert.ok(radarr.journal.deletes.some((d) => d.startsWith("/api/v3/queue/1")));
    assert.equal(radarr.journal.puts.at(-1)?.body.qualityProfileId, 5);
  });

  test("one search per run: a second swap waits its turn", async () => {
    film("a", 1, "Heat");
    film("b", 2, "Ronin");
    for (const id of [1, 2]) {
      radarr.pipeline.files.set(id, { id: 10 + id, movieId: id, quality: UHD, size: 1 });
      radarr.pipeline.releases.set(id, [{ guid: `g${id}`, title: `R${id}`, quality: FHD, size: 1 }]);
    }
    swaps.start({
      movies: [
        { instanceId: "radarr", arrMovieId: 1 },
        { instanceId: "radarr", arrMovieId: 2 },
      ],
      profiles: { radarr: 4 },
    });
    const result = await swaps.advanceAll({ searchBudget: 1 });
    assert.equal(result.waiting, 1);
    assert.equal(radarr.journal.grabs.length, 1);
  });
});
