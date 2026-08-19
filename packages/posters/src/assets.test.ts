import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findAsset, indexAssetDirectory, normaliseAssetName } from "./assets.ts";

/**
 * The whole value of this module is that it finds art a person made by hand for
 * titles a filesystem can't spell. So the tests that matter are the near-misses:
 * a colon that became a dash, an accent that got decomposed, a folder nested
 * one level deeper than expected.
 */

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "assets-"));

  // Folder layout.
  mkdirSync(join(root, "Star Wars (1977)"));
  writeFileSync(join(root, "Star Wars (1977)", "poster.jpg"), "x");
  writeFileSync(join(root, "Star Wars (1977)", "background.png"), "x");

  // A folder whose art uses one of the alternative basenames.
  mkdirSync(join(root, "Blade Runner (1982)"));
  writeFileSync(join(root, "Blade Runner (1982)", "folder.png"), "x");

  // A folder with nothing recognisable in it.
  mkdirSync(join(root, "Empty Folder"));
  writeFileSync(join(root, "Empty Folder", "notes.txt"), "x");

  // Flat layout, including a filesystem-safe spelling of a colon title.
  writeFileSync(join(root, "Alien - Covenant.jpg"), "x");
  writeFileSync(join(root, "Amelie.png"), "x");

  // Nested one level, as Kometa writes when `asset_folders` is on.
  mkdirSync(join(root, "Movies"));
  mkdirSync(join(root, "Movies", "Heat (1995)"));
  writeFileSync(join(root, "Movies", "Heat (1995)", "poster.webp"), "x");

  // Noise that must not be indexed.
  writeFileSync(join(root, "kometa.log"), "x");
  writeFileSync(join(root, ".hidden.jpg"), "x");
});

after(() => rmSync(root, { recursive: true, force: true }));

describe("name normalisation", () => {
  test("ignores case and punctuation, so a colon can become a dash", () => {
    assert.equal(normaliseAssetName("Alien: Covenant"), normaliseAssetName("Alien - Covenant"));
    assert.equal(normaliseAssetName("Star Wars (1977)"), normaliseAssetName("star wars 1977"));
  });

  test("folds accents, so a decomposed filename still matches", () => {
    assert.equal(normaliseAssetName("Amélie"), normaliseAssetName("Amelie"));
  });

  test("doesn't collapse genuinely different titles", () => {
    assert.notEqual(normaliseAssetName("Heat"), normaliseAssetName("Heat 2"));
  });
});

describe("indexing", () => {
  test("indexes both layouts and skips non-images", async () => {
    const index = await indexAssetDirectory(root);
    assert.ok(index.folders.has(normaliseAssetName("Star Wars (1977)")));
    assert.ok(index.files.has(normaliseAssetName("Alien - Covenant")));
    assert.ok(!index.files.has(normaliseAssetName("kometa")), "a .log is not artwork");
    assert.ok(!index.files.has(normaliseAssetName("hidden")), "dotfiles are skipped");
  });

  test("descends into per-library subfolders", async () => {
    // Kometa writes `assets/<Library>/<Item>/poster.ext` when asset_folders is
    // on; indexing only the top level would find nothing for those users.
    const index = await indexAssetDirectory(root);
    assert.ok(index.folders.has(normaliseAssetName("Heat (1995)")));
  });

  test("refuses a relative path and a missing directory", async () => {
    await assert.rejects(() => indexAssetDirectory("assets"), /absolute/i);
    await assert.rejects(() => indexAssetDirectory(join(root, "nope")), /No directory/);
  });

  test("an unset directory is empty rather than an error", async () => {
    const index = await indexAssetDirectory("");
    assert.equal(index.size, 0);
  });
});

describe("finding one collection's art", () => {
  test("finds a folder poster", async () => {
    const index = await indexAssetDirectory(root);
    const path = await findAsset(index, "Star Wars (1977)");
    assert.match(String(path), /Star Wars \(1977\)\/poster\.jpg$/);
  });

  test("finds a flat file, matching through a punctuation difference", async () => {
    const index = await indexAssetDirectory(root);
    const path = await findAsset(index, "Alien: Covenant");
    assert.match(String(path), /Alien - Covenant\.jpg$/);
  });

  test("accepts the alternative basenames Kometa allows", async () => {
    const index = await indexAssetDirectory(root);
    assert.match(String(await findAsset(index, "Blade Runner (1982)")), /folder\.png$/);
  });

  test("finds a background only in the folder layout", async () => {
    const index = await indexAssetDirectory(root);
    assert.match(String(await findAsset(index, "Star Wars (1977)", "background")), /background\.png$/);
    // The flat layout has no way to express one, so asking must not hand back
    // the poster.
    assert.equal(await findAsset(index, "Alien: Covenant", "background"), null);
  });

  test("a folder with no usable art is a miss, not a fallback", async () => {
    const index = await indexAssetDirectory(root);
    assert.equal(await findAsset(index, "Empty Folder"), null);
  });

  test("an unknown name is null rather than a wrong file", async () => {
    const index = await indexAssetDirectory(root);
    assert.equal(await findAsset(index, "Something Nobody Made Art For"), null);
    assert.equal(await findAsset(index, ""), null);
  });
});
