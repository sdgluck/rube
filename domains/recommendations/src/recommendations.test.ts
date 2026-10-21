/**
 * The fixture is written by `ml/` (`uv run recs fixture`), not by a TypeScript
 * helper: the parser is a contract with Python's writer, and a writer that
 * lived beside the parser would agree with every mistake it made.
 *
 * Its seven vectors are hand-placed in four dimensions, so each ranking below
 * can be checked by reading the numbers in `ml/recs/cli.py`'s `_fixture`.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConfigStore } from "@rube/core";
import { mediaItems } from "@rube/db";
import { createTestDb, type TestDb } from "@rube/db/test-db";
import { createRecommendations, describeSkip, MIN_COVERAGE, parseModel, solveSpd, type RankResult } from "./index.ts";

const FIXTURE = join(import.meta.dirname, "__fixtures__", "tiny.bin");

let t: TestDb;
const dbs: TestDb[] = [];
after(() => dbs.forEach((d) => d.dispose()));

/** ratingKey "m1" is movie:1 and so on; "s10" is the show tv:10; "x" has no vector. */
function seed(db: TestDb["db"]) {
  const item = (ratingKey: string, type: string, tmdbId: number | null) => ({
    ratingKey,
    type,
    tmdbId,
    sectionId: type === "show" ? "2" : "1",
    sectionTitle: type === "show" ? "TV" : "Movies",
    title: ratingKey,
    syncedAt: 0,
  });
  db.insert(mediaItems)
    .values([
      item("m1", "movie", 1),
      item("m2", "movie", 2),
      item("m3", "movie", 3),
      item("m4", "movie", 4),
      item("m5", "movie", 5),
      item("s10", "show", 10),
      item("m6", "movie", 6),
      // A movie whose TMDb id the model doesn't know, and one with no id at all.
      item("x", "movie", 999),
      item("y", "movie", null),
    ])
    .run();
}

/** The ranking, or null when it was skipped — what most assertions care about. */
const keys = (r: RankResult) => ("ratingKeys" in r ? r.ratingKeys : null);
/** Why it was skipped, or null when it ranked. */
const skip = (r: RankResult) => ("skipped" in r ? r.skipped : null);

function build(opts: { enabled?: boolean; modelPath?: string } = {}) {
  t = createTestDb();
  dbs.push(t);
  seed(t.db);
  const config = createConfigStore({ db: t.db, recordChange: () => {} });
  if (opts.enabled !== false) config.setConfig("recommender_enabled", true);
  return createRecommendations({ db: t.db, config, modelPath: opts.modelPath ?? FIXTURE });
}

describe("parseModel", () => {
  test("reads what ml/recs/export.py wrote", () => {
    const m = parseModel(readFileSync(FIXTURE));
    assert.equal(m.header.format, 1);
    assert.equal(m.header.dims, 4);
    assert.equal(m.header.count, 7);
    assert.deepEqual(m.header.sources, { collaborative: 5, content: 2 });
    // int8 quantisation: within half a step of the original.
    const v = m.vector(m.rows.get("movie:2")!);
    assert.ok(Math.abs(v[0]! - 0.9) < 0.01 && Math.abs(v[1]! - 0.1) < 0.01, `got ${[...v]}`);
    assert.ok(Math.abs(m.gram[0]! - (1 + 0.81 + 0.01 + 0.64 + 0.09)) < 0.02, "gram is YᵀY over the published vectors");
  });

  test("refuses a format it doesn't know rather than misreading it", () => {
    const buf = Buffer.from(readFileSync(FIXTURE));
    const headerLength = buf.readUInt32LE(4);
    const header = buf
      .subarray(8, 8 + headerLength)
      .toString()
      .replace('"format":1', '"format":9');
    buf.write(header, 8);
    assert.throws(() => parseModel(buf), /format 9 isn't supported/);
  });

  test("refuses a truncated file", () => {
    const buf = readFileSync(FIXTURE);
    assert.throws(() => parseModel(buf.subarray(0, buf.length - 8)), /truncated/);
  });
});

describe("solveSpd", () => {
  test("solves a known system", () => {
    const x = solveSpd(Float64Array.from([4, 2, 2, 3]), Float64Array.from([2, 1]), 2);
    assert.ok(Math.abs(x[0]! - 0.5) < 1e-12 && Math.abs(x[1]!) < 1e-12, `got ${[...x]}`);
  });
});

describe("shortlist", () => {
  test("ranks what sits nearest the liked history first", () => {
    const recs = build();
    const result = recs.shortlist({
      history: [{ ratingKey: "m1", weight: 1 }],
      candidates: ["m2", "m3", "m4", "m5", "s10"],
      limit: 3,
    });
    assert.deepEqual(keys(result), ["m2", "s10", "m5"]);
    // What the run log reports alongside the ranking.
    assert.ok("ratingKeys" in result);
    assert.deepEqual(result.coverage, { withVector: 5, total: 5 });
    assert.deepEqual(result.history, { used: 1, total: 1 });
  });

  test("a title given up on pushes its neighbours down", () => {
    const recs = build();
    // tv:10 leans a fifth towards movie:4's axis and movie:2 doesn't, so
    // whether movie:4 was liked or abandoned decides which of the two leads.
    const rank = (weight: number) =>
      keys(
        recs.shortlist({
          history: [
            { ratingKey: "m1", weight: 1 },
            { ratingKey: "m4", weight },
          ],
          candidates: ["m2", "s10"],
          limit: 2,
        }),
      );
    assert.deepEqual(rank(1), ["s10", "m2"]);
    assert.deepEqual(rank(-0.5), ["m2", "s10"]);
  });

  test("leaves out candidates it has no vector for", () => {
    const recs = build();
    const picks = keys(
      recs.shortlist({
        history: [{ ratingKey: "m1", weight: 1 }],
        candidates: ["m2", "m3", "m4", "x"],
        limit: 10,
      }),
    );
    assert.ok(picks && !picks.includes("x"), `got ${picks}`);
  });

  test("skips below the coverage floor, and says how far below", () => {
    const recs = build();
    // One of three candidates has a vector: well under MIN_COVERAGE.
    assert.ok(1 / 3 < MIN_COVERAGE);
    const result = recs.shortlist({
      history: [{ ratingKey: "m1", weight: 1 }],
      candidates: ["m2", "x", "y"],
      limit: 5,
    });
    assert.equal(skip(result), "coverage");
    assert.ok("skipped" in result);
    assert.match(describeSkip(result), /only 33% of these titles have a vector/);
  });

  test("says when none of the titles has a vector, rather than a percentage", () => {
    const result = build().shortlist({ history: [{ ratingKey: "m1", weight: 1 }], candidates: ["x", "y"], limit: 5 });
    assert.ok("skipped" in result);
    assert.equal(describeSkip(result), "none of these titles has a vector");
  });

  test("falls back when nothing they liked has a vector", () => {
    const recs = build();
    const candidates = ["m2", "m3", "m4"];
    assert.equal(
      skip(recs.shortlist({ history: [{ ratingKey: "x", weight: 1 }], candidates, limit: 5 })),
      "no-liked-history",
    );
    assert.equal(
      skip(recs.shortlist({ history: [{ ratingKey: "m1", weight: -0.5 }], candidates, limit: 5 })),
      "no-liked-history",
    );
  });

  test("does nothing until turned on", () => {
    const recs = build({ enabled: false });
    assert.equal(
      skip(recs.shortlist({ history: [{ ratingKey: "m1", weight: 1 }], candidates: ["m2", "m3"], limit: 5 })),
      "off",
    );
    assert.equal(recs.status().enabled, false);
  });
});

describe("similar", () => {
  test("ranks by likeness to the seed, never returning the seed", () => {
    const recs = build();
    assert.deepEqual(keys(recs.similar({ seed: "m1", candidates: ["m1", "m2", "m3", "s10", "m4"], limit: 2 })), [
      "m2",
      "s10",
    ]);
  });

  test("a short vector pointing the right way loses to a long one", () => {
    // movie:6 is movie:1's direction exactly, at a third of the length: a thin,
    // low-confidence projection. Cosine would put it first; it must not be.
    const recs = build();
    assert.deepEqual(keys(recs.similar({ seed: "m1", candidates: ["m6", "m2"], limit: 2 })), ["m2", "m6"]);
  });

  test("resolves a show through its tv: id", () => {
    const recs = build();
    assert.deepEqual(keys(recs.similar({ seed: "s10", candidates: ["m1", "m3", "m4"], limit: 1 })), ["m1"]);
  });

  test("falls back when the seed has no vector", () => {
    const recs = build();
    assert.equal(skip(recs.similar({ seed: "x", candidates: ["m1", "m2", "m3"], limit: 2 })), "seed-has-no-vector");
  });
});

describe("nearest", () => {
  test("ranks by likeness to the seeds together, never returning a seed", () => {
    // movie:3 and movie:4 are two axes; tv:10 leans toward movie:4's and
    // movie:2 toward movie:3's, more weakly; movie:1 is on neither.
    const recs = build();
    assert.deepEqual(
      keys(recs.nearest({ seeds: ["m3", "m4"], candidates: ["m1", "m2", "s10", "m3", "m4"], limit: 2 })),
      ["s10", "m2"],
    );
  });

  test("aims with the seeds that have a vector", () => {
    const recs = build();
    assert.deepEqual(keys(recs.nearest({ seeds: ["x", "m3"], candidates: ["m1", "m2", "m4"], limit: 1 })), ["m2"]);
  });

  test("falls back when no seed has a vector", () => {
    const recs = build();
    assert.equal(
      skip(recs.nearest({ seeds: ["x", "y"], candidates: ["m1", "m2", "m3"], limit: 2 })),
      "seed-has-no-vector",
    );
  });
});

describe("cohesion", () => {
  test("is the mean cosine over the pairs that have a vector", () => {
    const recs = build();
    // movie:1 and movie:6 point the same way; movie:3 is orthogonal to both.
    const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-3, `${a} ≉ ${b}`);
    near(recs.cohesion(["m1", "m6"]), 1);
    near(recs.cohesion(["m1", "m3"]), 0);
    near(recs.cohesion(["m1", "m6", "m3", "x"]), 1 / 3);
  });

  test("has nothing to say about fewer than two vectors, or when off", () => {
    assert.equal(build().cohesion(["m1", "x"]), null);
    assert.equal(build({ enabled: false }).cohesion(["m1", "m6"]), null);
  });
});

describe("coverage", () => {
  test("says how much it could rank, or why it can't", () => {
    assert.deepEqual(build().coverage(["m1", "m2", "x"]), { withVector: 2, total: 3 });
    assert.deepEqual(build().coverage(["m1", "x", "y"]), {
      skipped: "coverage",
      coverage: { withVector: 1, total: 3 },
    });
    assert.deepEqual(build({ enabled: false }).coverage(["m1"]), { skipped: "off" });
  });
});

describe("status", () => {
  test("reports the model and its attribution", () => {
    const status = build().status();
    assert.equal(status.available, true);
    assert.equal(status.model?.count, 7);
    assert.match(status.model?.attribution ?? "", /MovieLens/);
  });

  test("reports how much of each library the model can rank", () => {
    // Movies 1–6 and the show have vectors; "x" has an unknown id and "y" none.
    assert.deepEqual(build().status().libraries, [
      { sectionId: "1", sectionTitle: "Movies", withVector: 6, total: 8 },
      { sectionId: "2", sectionTitle: "TV", withVector: 1, total: 1 },
    ]);
  });

  test("a build without the model says so instead of throwing", () => {
    const recs = build({ modelPath: join(import.meta.dirname, "__fixtures__", "missing.bin") });
    const status = recs.status();
    assert.equal(status.available, false);
    assert.match(status.error ?? "", /doesn't include the recommender model/);
    assert.equal(
      skip(recs.shortlist({ history: [{ ratingKey: "m1", weight: 1 }], candidates: ["m2"], limit: 1 })),
      "no-model",
    );
  });
});
