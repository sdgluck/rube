import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createKometaYaml } from "./kometa-yaml.ts";

/**
 * The server half: reading a config directory off disk, and the guards that
 * stop that from being a way to walk the filesystem or hang the request.
 *
 * The database-backed halves (saving a bundle, resolving sections against
 * `plex_sections`) are exercised through the migration domain's own tests;
 * what's here is the part with no database in it and the most ways to go
 * wrong.
 */

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "kometa-yaml-"));
  mkdirSync(join(dir, "collections"), { recursive: true });
  writeFileSync(join(dir, "config.yml"), "libraries:\n  Movies:\n    collection_files:\n      - default: genre\n");
  writeFileSync(join(dir, "collections", "movies.yml"), "collections:\n  A:\n    imdb_list: ls1\n");
  // Noise that must not come along: not YAML, and a dotfile.
  writeFileSync(join(dir, "kometa.log"), "not yaml");
  writeFileSync(join(dir, ".env"), "SECRET=1");
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function subject(allowServerPath = true) {
  // `db` is never touched by the path-reading helpers under test.
  return createKometaYaml({ db: null as never, allowServerPath });
}

describe("reading a config directory from the server", () => {
  test("picks up YAML recursively and ignores everything else", async () => {
    const files = await subject().readServerPath(dir);
    const paths = files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["collections/movies.yml", "config.yml"]);
  });

  test("reports paths relative to the directory given", async () => {
    // Kometa's own `file:` references are relative, so bundle matching only
    // works if these are too.
    const files = await subject().readServerPath(dir);
    assert.ok(files.every((f) => !f.path.startsWith("/")));
  });

  test("reads a single file when pointed at one", async () => {
    const files = await subject().readServerPath(join(dir, "config.yml"));
    assert.equal(files.length, 1);
    assert.equal(files[0]!.path, "config.yml");
  });

  test("refuses a relative path", async () => {
    await assert.rejects(() => subject().readServerPath("config/config.yml"), /absolute/i);
  });

  test("says so when there's nothing there", async () => {
    await assert.rejects(() => subject().readServerPath(join(dir, "nope")), /Nothing found/);
  });

  test("says so when a real directory holds no YAML", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kometa-empty-"));
    try {
      await assert.rejects(() => subject().readServerPath(empty), /No YAML files/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("can be switched off for installs where the server's disk isn't the user's", async () => {
    await assert.rejects(() => subject(false).readServerPath(dir), /disabled/i);
  });

  test("a symlink loop terminates instead of hanging the request", async () => {
    const looped = mkdtempSync(join(tmpdir(), "kometa-loop-"));
    try {
      writeFileSync(join(looped, "config.yml"), "libraries: {}\n");
      mkdirSync(join(looped, "sub"));
      // `sub/back` points at the root, so a naive walk recurses forever.
      symlinkSync(looped, join(looped, "sub", "back"), "dir");
      const files = await subject().readServerPath(looped);
      assert.ok(files.length >= 1);
    } finally {
      rmSync(looped, { recursive: true, force: true });
    }
  });
});
