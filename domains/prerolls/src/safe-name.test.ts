import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isBareFilename } from "./safe-name.ts";

describe("isBareFilename", () => {
  test("accepts an ordinary filename", () => {
    assert.equal(isBareFilename("intro.mp4"), true);
    assert.equal(isBareFilename("My Studio Intro (2019).mkv"), true);
    // A leading dot is a hidden file, not a relative path.
    assert.equal(isBareFilename(".hidden.mp4"), true);
  });

  test("rejects anything carrying a path", () => {
    assert.equal(isBareFilename("../../etc/passwd"), false);
    assert.equal(isBareFilename("nested/intro.mp4"), false);
    assert.equal(isBareFilename("/absolute/intro.mp4"), false);
    assert.equal(isBareFilename("incoming/abc.mp4"), false);
  });

  test("rejects backslash paths even on POSIX, where basename ignores them", () => {
    assert.equal(isBareFilename("..\\..\\windows\\system32"), false);
    assert.equal(isBareFilename("C:\\media\\intro.mp4"), false);
  });

  test("rejects the empty string, the dot entries, and embedded NULs", () => {
    assert.equal(isBareFilename(""), false);
    assert.equal(isBareFilename("."), false);
    assert.equal(isBareFilename(".."), false);
    assert.equal(isBareFilename("intro.mp4\0.txt"), false);
  });
});
