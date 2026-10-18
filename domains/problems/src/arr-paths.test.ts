import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { folderOf, learnPlexRoot, toPlexPath } from "./arr-paths.ts";

describe("learnPlexRoot", () => {
  it("finds the Plex root when the containers mount the folder differently", () => {
    assert.equal(
      learnPlexRoot("/movies", "/movies/Heat (1995)", "/data/media/movies/Heat (1995)"),
      "/data/media/movies",
    );
  });

  it("is the same root when both sides agree", () => {
    assert.equal(learnPlexRoot("/movies/", "/movies/Heat (1995)", "/movies/Heat (1995)/"), "/movies");
  });

  it("refuses a sibling whose folder Plex names differently", () => {
    assert.equal(learnPlexRoot("/movies", "/movies/Heat (1995)", "/data/movies/Heat"), null);
  });

  it("refuses a sibling that isn't under the root", () => {
    assert.equal(learnPlexRoot("/movies", "/movies-4k/Heat (1995)", "/data/movies-4k/Heat (1995)"), null);
  });

  it("handles a Windows Plex", () => {
    assert.equal(learnPlexRoot("/tv", "/tv/The Wire", "D:\\TV\\The Wire"), "D:\\TV");
  });
});

describe("toPlexPath", () => {
  it("moves a folder from the *Arr root to the Plex root", () => {
    assert.equal(
      toPlexPath("/movies", "/movies/[REC]³ Genesis (2012)", "/data/media/movies"),
      "/data/media/movies/[REC]³ Genesis (2012)",
    );
  });

  it("uses the Plex side's separators", () => {
    assert.equal(toPlexPath("/tv", "/tv/The Wire", "D:\\TV"), "D:\\TV\\The Wire");
  });

  it("refuses a path outside the root, or the root itself", () => {
    assert.equal(toPlexPath("/movies", "/other/Heat (1995)", "/data/movies"), null);
    assert.equal(toPlexPath("/movies", "/movies", "/data/movies"), null);
  });

  it("round-trips with learnPlexRoot", () => {
    const root = learnPlexRoot("/movies", "/movies/Heat (1995)", "/mnt/films/Heat (1995)");
    assert.equal(toPlexPath("/movies", "/movies/Ronin (1998)", root!), "/mnt/films/Ronin (1998)");
  });
});

describe("folderOf", () => {
  it("drops the file name", () => {
    assert.equal(folderOf("/data/movies/Heat (1995)/Heat.mkv"), "/data/movies/Heat (1995)");
    assert.equal(folderOf("D:\\Films\\Heat\\Heat.mkv"), "D:\\Films\\Heat");
  });
});
