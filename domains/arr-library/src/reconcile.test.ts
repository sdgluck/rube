/**
 * Failed imports, against the shapes Sonarr and Radarr history really takes.
 *
 * Matching a grab to its import by download id alone put 200 rows on one
 * install's Problems page, most of them grabs that failed and were replaced by
 * a release that imported under a different id. Each case below is a way a
 * grab stops being a problem without its own download ever importing.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "@rube/db/test-db";
import { arrActivity, arrMovies, arrSeries } from "@rube/db";
import { createArrReconcile } from "./reconcile.ts";

const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - 10 * DAY;

let t: TestDb;
let historyId = 0;

beforeEach(() => {
  t = createTestDb();
  t.db.insert(arrSeries).values({ instanceId: "son", arrId: 7, title: "Big Brother", syncedAt: OLD }).run();
  t.db.insert(arrMovies).values({ instanceId: "rad", arrId: 5, title: "Heat", syncedAt: OLD }).run();
});
afterEach(() => t.dispose());

function event(
  e: Partial<typeof arrActivity.$inferInsert> & { eventType: string; downloadId: string; date: number },
): number {
  const id = ++historyId;
  t.db
    .insert(arrActivity)
    .values({
      instanceId: "son",
      service: "sonarr",
      arrHistoryId: id,
      arrId: 70,
      parentArrId: 7,
      sourceTitle: "Big.Brother.S28E11.720p",
      syncedAt: e.date,
      ...e,
    })
    .run();
  return id;
}

const failedImports = () => createArrReconcile({ db: t.db }).failedImports();

describe("failedImports", () => {
  it("reports a stale grab with nothing after it, titled by the series", () => {
    const id = event({ eventType: "grabbed", downloadId: "a", date: OLD });
    const [issue] = failedImports();
    assert.equal(issue.title, "Big Brother");
    assert.match(issue.detail, /as Big\.Brother\.S28E11\.720p/);
    assert.deepEqual(issue.grabHistoryIds, [id]);
  });

  it("skips a grab still inside the grace window", () => {
    event({ eventType: "grabbed", downloadId: "a", date: Date.now() - 1000 });
    assert.deepEqual(failedImports(), []);
  });

  it("skips a grab whose own download imported", () => {
    event({ eventType: "grabbed", downloadId: "a", date: OLD });
    event({ eventType: "downloadFolderImported", downloadId: "a", date: OLD + 1000 });
    assert.deepEqual(failedImports(), []);
  });

  it("skips a grab superseded by another release imported for the same episode", () => {
    event({ eventType: "grabbed", downloadId: "a", date: OLD });
    event({ eventType: "grabbed", downloadId: "b", date: OLD + 1000 });
    event({ eventType: "downloadFolderImported", downloadId: "b", date: OLD + 2000 });
    assert.deepEqual(failedImports(), []);
  });

  it("still reports an episode when only a different episode imported", () => {
    event({ eventType: "grabbed", downloadId: "a", date: OLD });
    event({ eventType: "downloadFolderImported", downloadId: "b", arrId: 71, date: OLD + 1000 });
    assert.equal(failedImports().length, 1);
  });

  it("skips a grab the *Arr already marked failed or ignored", () => {
    event({ eventType: "grabbed", downloadId: "a", date: OLD });
    event({ eventType: "downloadFailed", downloadId: "a", date: OLD + 1000 });
    event({ eventType: "grabbed", downloadId: "c", arrId: 72, date: OLD });
    event({ eventType: "downloadIgnored", downloadId: "c", arrId: 72, date: OLD + 1000 });
    assert.deepEqual(failedImports(), []);
  });

  it("skips grabs for a series or film the *Arr no longer has", () => {
    t.db.update(arrSeries).set({ deletedAt: OLD }).run();
    event({ eventType: "grabbed", downloadId: "a", date: OLD });
    event({ eventType: "grabbed", downloadId: "b", parentArrId: 99, date: OLD });
    assert.deepEqual(failedImports(), []);
  });

  it("folds several stale grabs of one item into one row, newest first", () => {
    const first = event({ eventType: "grabbed", downloadId: "a", date: OLD });
    const second = event({ eventType: "grabbed", downloadId: "b", date: OLD + 1000 });
    const issues = failedImports();
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0].grabHistoryIds, [second, first]);
    assert.match(issues[0].detail, /and 1 earlier grab\)/);
  });

  it("titles a Radarr grab by the film", () => {
    event({
      instanceId: "rad",
      service: "radarr",
      eventType: "grabbed",
      downloadId: "m",
      arrId: 5,
      parentArrId: 0,
      sourceTitle: "Heat.1995.1080p",
      date: OLD,
    });
    const [issue] = failedImports();
    assert.equal(issue.title, "Heat");
    assert.equal(issue.service, "radarr");
  });
});
