import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPrefValue, joinPlexPath, prefsMatch } from "./pref.ts";

describe("joinPlexPath", () => {
  test("joins with a forward slash", () => {
    assert.equal(joinPlexPath("/prerolls", "abc.mp4"), "/prerolls/abc.mp4");
  });

  test("tolerates trailing slashes and backslashes", () => {
    assert.equal(joinPlexPath("/prerolls/", "abc.mp4"), "/prerolls/abc.mp4");
    assert.equal(joinPlexPath("/prerolls//", "abc.mp4"), "/prerolls/abc.mp4");
    assert.equal(joinPlexPath("C:\\media\\prerolls\\", "abc.mp4"), "C:\\media\\prerolls/abc.mp4");
  });

  test("falls back to the bare filename when no directory is configured", () => {
    assert.equal(joinPlexPath("", "abc.mp4"), "abc.mp4");
  });
});

describe("buildPrefValue", () => {
  const files = ["a.mp4", "b.mp4", "c.mp4"];

  test("random mode joins with commas", () => {
    assert.equal(buildPrefValue(files, "/prerolls", "random"), "/prerolls/a.mp4,/prerolls/b.mp4,/prerolls/c.mp4");
  });

  test("sequential mode joins with semicolons", () => {
    assert.equal(buildPrefValue(files, "/prerolls", "sequential"), "/prerolls/a.mp4;/prerolls/b.mp4;/prerolls/c.mp4");
  });

  test("a single preroll carries no separator at all", () => {
    assert.equal(buildPrefValue(["a.mp4"], "/prerolls", "random"), "/prerolls/a.mp4");
  });

  test("an empty pool produces an empty value, which is how Plex disables prerolls", () => {
    assert.equal(buildPrefValue([], "/prerolls", "random"), "");
  });
});

describe("prefsMatch", () => {
  test("ignores surrounding whitespace only", () => {
    assert.equal(prefsMatch("/p/a.mp4", " /p/a.mp4 "), true);
    assert.equal(prefsMatch("/p/a.mp4,/p/b.mp4", "/p/a.mp4;/p/b.mp4"), false);
    assert.equal(prefsMatch("", ""), true);
    assert.equal(prefsMatch("", "/p/stale.mp4"), false);
  });
});
