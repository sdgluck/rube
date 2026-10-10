import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareShow,
  normaliseTitle,
  showFolder,
  titlesAgree,
  type LeafLike,
  type SonarrEpisodeLike,
} from "./ordering.ts";

/** The Office (US) season 4 as TheTVDB — and so Sonarr — numbers it: hour-longs split in two. */
const TVDB_S4 = [
  "Fun Run (1)",
  "Fun Run (2)",
  "Dunder Mifflin Infinity (1)",
  "Dunder Mifflin Infinity (2)",
  "Launch Party (1)",
  "Launch Party (2)",
  "Money (1)",
  "Money (2)",
  "Local Ad",
  "Branch Wars",
  "Survivor Man",
  "The Deposition",
  "Dinner Party",
  "The Chair Model",
  "Night Out",
  "Did I Stutter?",
  "Job Fair",
  "Goodbye, Toby (1)",
  "Goodbye, Toby (2)",
];

/** The same season as TMDb numbers it: fourteen episodes, each hour-long one whole. */
const TMDB_S4 = [
  "Fun Run",
  "Dunder Mifflin Infinity",
  "Launch Party",
  "Money",
  "Local Ad",
  "Branch Wars",
  "Survivor Man",
  "The Deposition",
  "Dinner Party",
  "Chair Model",
  "Night Out",
  "Did I Stutter?",
  "Job Fair",
  "Goodbye, Toby",
];

function sonarr(titles: string[], season = 4): SonarrEpisodeLike[] {
  return titles.map((title, i) => ({
    seasonNumber: season,
    episodeNumber: i + 1,
    title,
    hasFile: true,
    episodeFileId: 100 + i,
  }));
}

/**
 * What Plex lists when the files are named by TVDB but the show is on TMDb
 * ordering: one leaf per file number, titled from TMDb's episode at that
 * number — and a placeholder past the end of TMDb's season.
 */
function plexUnder(ordering: string[], count: number, season = 4): LeafLike[] {
  return Array.from({ length: count }, (_, i) => ({
    season,
    episode: i + 1,
    title: ordering[i] ?? `Episode ${i + 1}`,
    files: [`/tv/The Office (US)/Season ${season}/S${season}E${i + 1}.mkv`],
  }));
}

describe("normaliseTitle", () => {
  it("drops part markers, a leading article and punctuation", () => {
    assert.equal(normaliseTitle("Goodbye, Toby (1)"), "goodbyetoby");
    assert.equal(normaliseTitle("The Chair Model"), "chairmodel");
    assert.equal(normaliseTitle("Pilot, Part 2"), "pilot");
    assert.equal(normaliseTitle("Café & Bar"), "cafeandbar");
  });

  it("treats two providers' spellings of one episode as agreeing", () => {
    assert.ok(titlesAgree("Chair Model", "The Chair Model"));
    assert.ok(titlesAgree("Goodbye, Toby", "Goodbye, Toby (2)"));
    assert.ok(!titlesAgree("Dinner Party", "Local Ad"));
  });
});

describe("compareShow", () => {
  it("flags The Office (US) season 4 on TMDb ordering, with the episode that prompted it", () => {
    const result = compareShow(plexUnder(TMDB_S4, 19), sonarr(TVDB_S4));
    assert.ok(result.ordering, "the season should be flagged");
    assert.deepEqual(
      result.ordering.seasons.map((s) => s.season),
      [4],
    );
    // Only S04E01 lines up; every split after it pushes the rest one further
    // out, which is how Plex came to call Sonarr's S04E13 "Dinner Party" #9.
    assert.equal(result.ordering.seasons[0].compared, 19);
    assert.equal(result.ordering.seasons[0].mismatched, 18);
    assert.deepEqual(result.ordering.examples[0], {
      code: "S04E02",
      plex: "Dunder Mifflin Infinity",
      sonarr: "Fun Run (2)",
    });
    assert.deepEqual(result.missing, [], "missing episodes are not reported under a wrong ordering");
  });

  it("does not flag a show whose numbering agrees", () => {
    const result = compareShow(plexUnder(TVDB_S4, 19), sonarr(TVDB_S4));
    assert.equal(result.ordering, null);
  });

  it("does not flag a season with only a few stale titles left after a refresh", () => {
    // Seen on a real server just after switching to TVDB ordering: the first
    // four episodes still carried TMDb's titles. Three of nineteen is noise
    // that the next refresh clears, not a wrong ordering.
    const leaves = plexUnder(TVDB_S4, 19);
    leaves[1].title = "Dunder Mifflin Infinity";
    leaves[2].title = "Launch Party";
    leaves[3].title = "Money";
    assert.equal(compareShow(leaves, sonarr(TVDB_S4)).ordering, null);
  });

  it("ignores specials and episodes Sonarr hasn't named", () => {
    const leaves: LeafLike[] = [...plexUnder(TVDB_S4, 19), { season: 0, episode: 1, title: "Blooper Reel", files: [] }];
    const episodes = [
      ...sonarr(TVDB_S4),
      { seasonNumber: 0, episodeNumber: 1, title: "Something Else", hasFile: true },
    ];
    episodes[0] = { ...episodes[0], title: "TBA" };
    assert.equal(compareShow(leaves, episodes).ordering, null);
  });

  it("lists episodes Sonarr has a file for that Plex doesn't", () => {
    const leaves = plexUnder(TVDB_S4, 19).filter((l) => l.episode !== 7 && l.episode !== 12);
    const result = compareShow(leaves, sonarr(TVDB_S4));
    assert.equal(result.ordering, null);
    assert.deepEqual(result.missing, ["S04E07", "S04E12"]);
  });

  it("counts files Sonarr says cover two episodes", () => {
    const episodes = sonarr(TVDB_S4);
    episodes[0].episodeFileId = 1;
    episodes[1].episodeFileId = 1;
    const result = compareShow(plexUnder(TMDB_S4, 19), episodes);
    assert.equal(result.ordering?.multiEpisodeFiles, 1);
  });
});

describe("showFolder", () => {
  it("climbs out of a season folder so one scan covers the show", () => {
    assert.equal(showFolder(plexUnder(TMDB_S4, 1)), "/tv/The Office (US)");
  });

  it("keeps a flat show folder as it is", () => {
    assert.equal(showFolder([{ season: 1, episode: 1, title: "", files: ["/tv/Show/S01E01.mkv"] }]), "/tv/Show");
  });

  it("has nothing to say about a show with no files", () => {
    assert.equal(showFolder([]), null);
  });
});
