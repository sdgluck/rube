/**
 * The Problems domain against a mock Plex and a mock Sonarr over real HTTP.
 *
 * The bug this feature exists for lives on the wire — which endpoint carries
 * a show's ordering, which vocabulary a library pref uses, that the write is a
 * PUT to `/prefs` and only takes effect after a refresh — so a `fetch` stub
 * would agree with every mistake worth catching here.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "@tinkerbell/db/test-db";
import { arrSeries, mediaItems, ruleRuns, rules, showChecks } from "@tinkerbell/db";
import { createConfigStore, type ArrInstance } from "@tinkerbell/core";
import { createPlexClient } from "@tinkerbell/plex";
import { createArrLibrary } from "@tinkerbell/domain.arr-library";
import { startMockPlex, startMockSonarr, type MockArr, type MockPlex, type MockShow } from "@tinkerbell/test-support";
import type { ChangeRecord } from "@tinkerbell/ports";
import { createProblems } from "./index.ts";

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
];
const TMDB_S4 = ["Fun Run", "Dunder Mifflin Infinity", "Launch Party", "Money", "Local Ad"];

const OFFICE: MockShow = {
  ratingKey: "100",
  title: "The Office (US)",
  sectionId: "2",
  episodes: TVDB_S4.map((_, i) => ({
    season: 4,
    episode: i + 1,
    title: TMDB_S4[i] ?? `Episode ${i + 1}`,
    file: `/tv/The Office (US)/Season 04/The Office (US) - S04E${String(i + 1).padStart(2, "0")}.mkv`,
  })),
};

describe("problems", () => {
  let t: TestDb;
  let plex: MockPlex;
  let sonarr: MockArr;
  let events: Array<{ type: string; message: string }>;
  let changes: ChangeRecord[];
  let now: number;

  async function setup(show: MockShow = OFFICE) {
    plex = await startMockPlex({ sections: [{ key: "2", title: "TV", type: "show" }], items: [], shows: [show] });
    sonarr = await startMockSonarr([{ id: 7, title: "The Office (US)", tvdbId: 73244, monitored: true }], {
      episodes: TVDB_S4.map((title, i) => ({
        id: 1000 + i,
        seriesId: 7,
        seasonNumber: 4,
        episodeNumber: i + 1,
        title,
        hasFile: true,
        episodeFileId: 500 + i,
      })),
    });
    t.db
      .insert(mediaItems)
      .values({
        ratingKey: show.ratingKey,
        sectionId: "2",
        sectionTitle: "TV",
        title: show.title,
        type: "show",
        leafCount: show.episodes.length,
        agentGuid: show.guid ?? `plex://show/${show.ratingKey}`,
        tvdbId: 73244,
        syncedAt: 0,
      })
      .run();
    t.db
      .insert(arrSeries)
      .values({
        instanceId: "sonarr",
        arrId: 7,
        title: "The Office (US)",
        tvdbId: 73244,
        plexRatingKey: show.ratingKey,
        episodeCount: TVDB_S4.length,
        episodeFileCount: TVDB_S4.length,
        syncedAt: 0,
      })
      .run();

    const instance: ArrInstance = {
      id: "sonarr",
      service: "sonarr",
      name: "Sonarr",
      url: sonarr.origin,
      apiKey: "k",
      isDefault: true,
    };
    const config = createConfigStore({ db: t.db, recordChange: () => {} });
    return createProblems({
      db: t.db,
      config,
      plex: (opts) => createPlexClient({ url: plex.origin, token: "t", signal: opts?.signal }),
      arrInstances: () => [instance],
      reconcile: createArrLibrary({ db: t.db }),
      ruleConflicts: () => [],
      recordChange: (c) => changes.push(c),
      emitEvent: (type, message) => events.push({ type, message }),
      now: () => now,
    });
  }

  beforeEach(() => {
    t = createTestDb();
    events = [];
    changes = [];
    now = 1_000_000;
  });
  afterEach(async () => {
    await plex?.close();
    await sonarr?.close();
    t.dispose();
  });

  it("finds a show on the wrong ordering, and fixes it by setting the ordering then refreshing", async () => {
    const problems = await setup();
    const result = await problems.scanShows();
    assert.equal(result.checked, 1);

    const found = problems.list().problems.find((p) => p.kind === "episodeOrdering");
    assert.ok(found, "the show should be reported");
    assert.equal(found.subject, "plex:100");
    assert.match(found.detail, /season 4/);
    // The library default is `tmdbAiring`, and the show doesn't override it.
    assert.match(found.detail, /The Movie Database/);
    assert.ok(found.fixable);

    const fix = await problems.fix("episodeOrdering", "plex:100");
    assert.match(fix.message, /TheTVDB/);
    assert.deepEqual(
      plex.journal.showWrites.map((w) => [w.action, w.params?.showOrdering]),
      [
        ["prefs", "tvdbAiring"],
        ["refresh", undefined],
      ],
    );
    assert.equal(plex.shows.get("100")?.ordering, "tvdbAiring");

    // Until a scan looks again, the fix is pending rather than confirmed.
    const pending = problems.list().problems.find((p) => p.kind === "episodeOrdering");
    assert.equal(pending?.fixPending, true);

    // Plex's refresh renumbers the show; the next scan confirms it and the
    // problem goes. The signature was cleared by the fix, so it is fetched
    // even though no count changed.
    const office = plex.shows.get("100") as MockShow;
    office.episodes = office.episodes.map((e, i) => ({ ...e, title: TVDB_S4[i] }));
    now += 1000;
    const rescan = await problems.scanShows();
    assert.equal(rescan.checked, 1);
    assert.equal(
      problems.list().problems.some((p) => p.kind === "episodeOrdering"),
      false,
    );
  });

  it("only refreshes a show that is already on TheTVDB ordering", async () => {
    const problems = await setup({ ...OFFICE, ordering: "tvdbAiring" });
    await problems.scanShows();
    const found = problems.list().problems.find((p) => p.kind === "episodeOrdering");
    assert.equal(found?.fixLabel, "Refresh metadata");
    await problems.fix("episodeOrdering", "plex:100");
    assert.deepEqual(
      plex.journal.showWrites.map((w) => w.action),
      ["refresh"],
    );
  });

  it("refuses to fix a show on a legacy agent, which ignores episode ordering", async () => {
    const problems = await setup({ ...OFFICE, guid: "com.plexapp.agents.thetvdb://73244?lang=en" });
    await problems.scanShows();
    const found = problems.list().problems.find((p) => p.kind === "episodeOrdering");
    assert.equal(found?.fixable, false);
    await assert.rejects(problems.fix("episodeOrdering", "plex:100"), /no automatic fix/);
    assert.deepEqual(plex.journal.showWrites, []);
    // And it is reported as a legacy-agent item in its own right.
    assert.ok(problems.list().problems.some((p) => p.kind === "legacyAgent" && p.subject === "plex:100"));
  });

  it("skips an unchanged show on the next scan", async () => {
    const problems = await setup();
    await problems.scanShows();
    const before = sonarr.journal.requests.filter((r) => r.includes("/episode")).length;
    const second = await problems.scanShows();
    assert.equal(second.unchanged, 1);
    assert.equal(second.checked, 0);
    assert.equal(sonarr.journal.requests.filter((r) => r.includes("/episode")).length, before);
  });

  it("reports missing episodes and scans the show's folder, not its season folder", async () => {
    const agreeing: MockShow = {
      ...OFFICE,
      episodes: OFFICE.episodes.map((e, i) => ({ ...e, title: TVDB_S4[i] })).filter((e) => e.episode !== 3),
    };
    const problems = await setup(agreeing);
    await problems.scanShows();
    const found = problems.list().problems.find((p) => p.kind === "missingEpisodes");
    assert.match(found?.detail ?? "", /S04E03/);
    await problems.fix("missingEpisodes", "plex:100");
    assert.deepEqual(plex.journal.pathScans, [{ sectionId: "2", path: "/tv/The Office (US)" }]);
  });

  it("hides a dismissed problem until its evidence changes, and records the dismissal", async () => {
    const problems = await setup();
    await problems.scanShows();
    problems.dismiss("episodeOrdering", "plex:100");
    assert.equal(problems.list().problems.find((p) => p.kind === "episodeOrdering")?.dismissed, true);
    assert.equal(changes.at(-1)?.entity, "problem_dismissal");

    // A second disagreeing season is a different problem from the one waved off.
    t.db
      .update(showChecks)
      .set({ orderingEvidence: { seasons: [{ season: 4 }, { season: 5 }], examples: [], multiEpisodeFiles: 0 } })
      .run();
    assert.equal(problems.list().problems.find((p) => p.kind === "episodeOrdering")?.dismissed, false);

    problems.undismiss("episodeOrdering", "plex:100");
    assert.equal(changes.at(-1)?.action, "delete");
  });

  it("dismisses and restores a selection in one call, skipping what is no longer reported", async () => {
    const problems = await setup({ ...OFFICE, guid: "com.plexapp.agents.thetvdb://73244?lang=en" });
    await problems.scanShows();
    const result = problems.dismissMany([
      { kind: "episodeOrdering", subject: "plex:100" },
      { kind: "legacyAgent", subject: "plex:100" },
      { kind: "unmatched", subject: "plex:gone" },
    ]);
    assert.equal(result.dismissed, 2);
    assert.deepEqual(result.skipped, [{ kind: "unmatched", subject: "plex:gone" }]);
    const dismissed = problems
      .list()
      .problems.filter((p) => p.dismissed)
      .map((p) => p.kind)
      .sort();
    assert.deepEqual(dismissed, ["episodeOrdering", "legacyAgent"]);
    assert.equal(changes.filter((c) => c.entity === "problem_dismissal" && c.action === "create").length, 2);

    const restored = problems.undismissMany([
      { kind: "episodeOrdering", subject: "plex:100" },
      { kind: "legacyAgent", subject: "plex:100" },
    ]);
    assert.equal(restored.restored, 2);
    assert.equal(
      problems.list().problems.some((p) => p.dismissed),
      false,
    );
  });

  it("fixes only the selected subjects", async () => {
    const problems = await setup();
    await problems.scanShows();
    const none = await problems.fixAll("episodeOrdering", ["plex:999"]);
    assert.equal(none.fixed, 0);
    assert.deepEqual(plex.journal.showWrites, []);

    const one = await problems.fixAll("episodeOrdering", ["plex:100"]);
    assert.equal(one.fixed, 1);
    assert.ok(plex.journal.showWrites.length > 0);
  });

  it("announces a problem once, not on every scan", async () => {
    const problems = await setup();
    await problems.scanShows();
    assert.equal(problems.announceNew().length, 1);
    assert.equal(events.filter((e) => e.type === "problems.found").length, 1);
    assert.match(events[0].message, /The Office \(US\)/);

    assert.equal(problems.announceNew().length, 0);
    assert.equal(events.length, 1);
  });

  it("reports a rule that stopped matching, and one whose last run failed", async () => {
    const problems = await setup();
    t.db.insert(rules).values({ id: "r1", name: "Oscar Winners", type: "collection", createdAt: 0 }).run();
    t.db.insert(rules).values({ id: "r2", name: "Broken", type: "collection", createdAt: 0 }).run();
    const run = (id: string, ruleId: string, status: string, itemCount: number | null, startedAt: number) =>
      t.db
        .insert(ruleRuns)
        .values({ id, ruleId, phase: "run", trigger: "job", status, itemCount, startedAt, updatedAt: startedAt })
        .run();
    run("a", "r1", "ok", 34, 1);
    run("b", "r1", "ok", 0, 2);
    run("c", "r2", "error", null, 1);

    const kinds = problems
      .list()
      .problems.filter((p) => p.subject.startsWith("rule:"))
      .map((p) => `${p.kind}:${p.title}`)
      .sort();
    assert.deepEqual(kinds, ["ruleEmpty:Oscar Winners", "ruleFailing:Broken"]);
  });
});
