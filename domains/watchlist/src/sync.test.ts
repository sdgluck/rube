/**
 * Watchlist sync, against the real container and a stubbed network.
 *
 * Everything worth asserting here is about *not* acting twice. The watchlist
 * is a list that never changes its answer, so the whole feature rests on the
 * ledger being right about what has already been dealt with — a bug there
 * doesn't fail, it quietly requests the same film every fifteen minutes.
 *
 * plex.tv, the media server and Radarr are all stubbed at `fetch`, and the
 * stub records every *Arr mutation so a test expecting nothing to be requested
 * fails on the request rather than on a count that could be zero for the wrong
 * reason.
 */
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken, noopCheckpoint, type JobContext } from "@tinkerbell/core";
import { DbToken, watchlistItems } from "@tinkerbell/db";

import { WatchlistToken } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { syncWatchlist, listWatchlistItems, retryWatchlistItem } = c.resolve(WatchlistToken);

const realFetch = globalThis.fetch;

interface Entry {
  guid: string;
  ratingKey: string;
  title: string;
  type: string;
  year?: number;
  guids: string[];
}

const MATRIX: Entry = {
  guid: "plex://movie/matrix",
  ratingKey: "rk-matrix",
  title: "The Matrix",
  type: "movie",
  year: 1999,
  guids: ["tmdb://603", "imdb://tt0133093"],
};

interface Calls {
  /** Every `POST /api/v3/movie` — one per real add. */
  adds: string[];
  /** Every `PUT /actions/removeFromWatchlist`, by rating key. */
  removals: string[];
  /** How many pages of the watchlist were fetched. */
  pages: number;
}

interface StubOptions {
  entries?: Entry[];
  /** TMDb ids present in the Plex movie library. */
  library?: number[];
  /** Raw provider guids present in the library, when the id isn't a TMDb one. */
  libraryGuids?: string[];
  /** Make every Radarr add fail, to exercise the failure ledger. */
  addFails?: boolean;
  /** `hasFile` on the Radarr library record, for the availability re-check. */
  hasFile?: boolean;
}

function stubServers(opts: StubOptions = {}): Calls {
  const entries = opts.entries ?? [MATRIX];
  const library = [...(opts.library ?? []).map((id) => `tmdb://${id}`), ...(opts.libraryGuids ?? [])];
  const calls: Calls = { adds: [], removals: [], pages: 0 };
  const PAGE_SIZE = 100;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    // ── plex.tv, the account service ──
    if (url.host === "metadata.provider.plex.tv") {
      if (url.pathname === "/actions/removeFromWatchlist") {
        assert.equal(method, "PUT", "removal is a PUT — a DELETE silently does nothing");
        calls.removals.push(url.searchParams.get("ratingKey") ?? "");
        return new Response(null, { status: 200 });
      }
      if (url.pathname === "/library/sections/watchlist/all") {
        calls.pages++;
        const start = Number(url.searchParams.get("X-Plex-Container-Start") ?? 0);
        const page = entries.slice(start, start + PAGE_SIZE);
        return json({
          MediaContainer: {
            totalSize: entries.length,
            Metadata: page.map((e) => ({
              guid: e.guid,
              ratingKey: e.ratingKey,
              title: e.title,
              type: e.type,
              year: e.year,
              addedAt: 1_700_000_000,
              Guid: e.guids.map((id) => ({ id })),
            })),
          },
        });
      }
      return json({ MediaContainer: {} });
    }

    // ── Radarr ──
    if (url.port === "7878") {
      if (url.pathname === "/api/v3/movie" && method === "POST") {
        if (opts.addFails) {
          return new Response("Root folder is not writable", { status: 500, statusText: "Internal Server Error" });
        }
        calls.adds.push(String(JSON.parse(String(init?.body ?? "{}")).tmdbId ?? ""));
        return json({ id: 42, title: "Added" });
      }
      if (url.pathname === "/api/v3/movie/lookup") {
        const term = url.searchParams.get("term") ?? "";
        const tmdb = Number(term.replace("tmdb:", ""));
        return json([{ title: "Looked up", year: 1999, tmdbId: tmdb }]);
      }
      // The library record, for the availability re-check.
      if (url.pathname === "/api/v3/movie") {
        return json([{ id: 42, title: "Looked up", tmdbId: 603, monitored: true, hasFile: opts.hasFile === true }]);
      }
      return json([]);
    }

    // ── The media server ──
    if (url.pathname === "/library/sections") {
      return json({ MediaContainer: { Directory: [{ key: "1", title: "Films", type: "movie" }] } });
    }
    if (url.pathname.startsWith("/library/sections/")) {
      return json({
        MediaContainer: {
          totalSize: library.length,
          Metadata: library.map((guid) => ({
            ratingKey: `plex-${guid}`,
            title: "In the library",
            Guid: [{ id: guid }],
          })),
        },
      });
    }
    if (url.pathname === "/") {
      return json({ MediaContainer: { friendlyName: "Test", machineIdentifier: "m-1" } });
    }
    return json({ MediaContainer: {} });
  }) as typeof fetch;

  return calls;
}

function testContext(): JobContext {
  return {
    scope: c.createScope("test"),
    log: () => {},
    progress: () => {},
    signal: new AbortController().signal,
    checkpoint: noopCheckpoint,
  };
}

function configure(over: Record<string, unknown> = {}): void {
  setConfig("global_plex_url", "http://plex.test:32400");
  setConfig("global_plex_token", "plex-token");
  setConfig("global_radarr_url", "http://arr.test:7878");
  setConfig("global_radarr_api_key", "radarr-key");
  setConfig("watchlist_sync", {
    enabled: true,
    radarr: {
      enabled: true,
      qualityProfileId: 1,
      rootFolderPath: "/films",
      monitor: true,
      searchOnAdd: true,
    },
    sonarr: { enabled: false, qualityProfileId: 0, rootFolderPath: "", monitor: true, searchOnAdd: true },
    removeOnAvailable: false,
    maxAddsPerRun: 20,
    dryRun: false,
    ...over,
  } as never);
}

function rowFor(guid: string) {
  return listWatchlistItems().find((r) => r.guid === guid);
}

beforeEach(() => {
  db.delete(watchlistItems).run();
  configure();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("reading the list", () => {
  it("assembles every page, and stops on a short one", async () => {
    // 150 items: one full page of 100, then a partial page that terminates it.
    const many = Array.from({ length: 150 }, (_, i) => ({
      guid: `plex://movie/${i}`,
      ratingKey: `rk-${i}`,
      title: `Film ${i}`,
      type: "movie",
      guids: [`tmdb://${1000 + i}`],
    }));
    const calls = stubServers({ entries: many, library: [] });

    await syncWatchlist(testContext());

    assert.equal(calls.pages, 2, "a 150-item list is two requests, not three and not one");
    assert.equal(listWatchlistItems(500).length, 150, "every entry reaches the ledger");
  });

  it("records what it saw even when it cannot act on it", async () => {
    // No provider ids at all: identifiable to Plex, useless to an *Arr.
    stubServers({ entries: [{ ...MATRIX, guids: [] }] });

    await syncWatchlist(testContext());

    const row = rowFor(MATRIX.guid);
    assert.equal(row?.status, "skipped");
    assert.match(row?.error ?? "", /no IMDb\/TMDb\/TVDb id/, "the reason is on the row, not only in a log");
  });
});

describe("what reaches Radarr", () => {
  it("does not request an item already in the library", async () => {
    const calls = stubServers({ library: [603] });

    await syncWatchlist(testContext());

    assert.deepEqual(calls.adds, [], "nothing is sent for a film already on disk");
    assert.equal(rowFor(MATRIX.guid)?.status, "present");
  });

  it("matches on any provider id, not just the one Radarr indexes on", async () => {
    // Present in Plex under IMDb only, while Radarr would be asked about TMDb.
    // Testing a single id here would re-request a film sitting on disk.
    const calls = stubServers({
      entries: [{ ...MATRIX, guids: ["tmdb://603", "imdb://tt0133093"] }],
      libraryGuids: ["imdb://tt0133093"],
    });

    await syncWatchlist(testContext());

    assert.deepEqual(calls.adds, []);
    assert.equal(rowFor(MATRIX.guid)?.status, "present");
  });

  it("requests an absent item once, and never again", async () => {
    const calls = stubServers({ library: [] });

    await syncWatchlist(testContext());
    assert.deepEqual(calls.adds, ["603"]);
    assert.equal(rowFor(MATRIX.guid)?.status, "requested");
    assert.ok(rowFor(MATRIX.guid)?.requestedAt, "the row records when it was requested");

    await syncWatchlist(testContext());
    assert.deepEqual(calls.adds, ["603"], "a second run must not re-request it");
  });

  it("does not re-request an item removed from the watchlist and added back", async () => {
    const calls = stubServers({ library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(calls.adds, ["603"]);

    // Gone from the list…
    globalThis.fetch = realFetch;
    const empty = stubServers({ entries: [], library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(empty.adds, []);

    // …and back again. The row outlived the entry, which is the point.
    globalThis.fetch = realFetch;
    const again = stubServers({ library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(again.adds, [], "re-adding is not a way to request the same film twice");
  });
});

describe("failures and caps", () => {
  it("records a failed add with its reason, and retries it next run", async () => {
    stubServers({ library: [], addFails: true });
    await syncWatchlist(testContext());

    const row = rowFor(MATRIX.guid);
    assert.equal(row?.status, "failed");
    assert.match(row?.error ?? "", /500/, "the error is kept, not just the fact of failure");
    assert.equal(row?.requestedAt, null, "a failed add is not a request");

    // The next run finds it actionable again — a failure that stuck would mean
    // one bad afternoon at Radarr loses the item permanently.
    globalThis.fetch = realFetch;
    const calls = stubServers({ library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(calls.adds, ["603"]);
    assert.equal(rowFor(MATRIX.guid)?.status, "requested");
  });

  it("makes no Radarr mutation on a dry run, and leaves the work to do", async () => {
    configure({ dryRun: true });
    const calls = stubServers({ library: [] });

    await syncWatchlist(testContext());

    assert.deepEqual(calls.adds, []);
    assert.equal(rowFor(MATRIX.guid)?.status, "new", "turning dry run off must pick this up");
  });

  it("caps a large first sync and takes the remainder next run", async () => {
    configure({ maxAddsPerRun: 2 });
    const many = Array.from({ length: 5 }, (_, i) => ({
      guid: `plex://movie/${i}`,
      ratingKey: `rk-${i}`,
      title: `Film ${i}`,
      type: "movie",
      guids: [`tmdb://${2000 + i}`],
    }));
    const calls = stubServers({ entries: many, library: [] });

    await syncWatchlist(testContext());
    assert.equal(calls.adds.length, 2, "the cap is a cap");

    await syncWatchlist(testContext());
    assert.equal(calls.adds.length, 4, "and the rest are not forgotten");

    await syncWatchlist(testContext());
    assert.equal(calls.adds.length, 5);
  });
});

describe("tidying the list", () => {
  it("leaves the watchlist alone unless asked", async () => {
    const calls = stubServers({ library: [603] });
    await syncWatchlist(testContext());
    assert.deepEqual(calls.removals, [], "somebody's own Plex account is not ours to edit by default");
  });

  it("removes an item once it is in the library", async () => {
    configure({ removeOnAvailable: true });
    const calls = stubServers({ library: [603] });

    await syncWatchlist(testContext());

    assert.deepEqual(calls.removals, ["rk-matrix"], "keyed by rating key, which is why the column exists");
  });

  it("removes a requested item once Radarr reports the file, not before", async () => {
    configure({ removeOnAvailable: true });
    const pending = stubServers({ library: [], hasFile: false });
    await syncWatchlist(testContext());
    assert.deepEqual(pending.adds, ["603"]);
    assert.deepEqual(pending.removals, [], "a request is not an arrival");

    globalThis.fetch = realFetch;
    const arrived = stubServers({ library: [], hasFile: true });
    await syncWatchlist(testContext());
    assert.deepEqual(arrived.removals, ["rk-matrix"]);
    assert.equal(rowFor(MATRIX.guid)?.status, "present");
  });
});

describe("the escape hatch", () => {
  it("re-queues a skipped item once the configuration is fixed", async () => {
    configure({
      radarr: { enabled: true, qualityProfileId: 0, rootFolderPath: "", monitor: true, searchOnAdd: true },
    });
    const first = stubServers({ library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(first.adds, []);
    assert.equal(rowFor(MATRIX.guid)?.status, "skipped");

    // Without the retry the row stays skipped forever, and the only remedy is
    // editing the watchlist in the Plex app.
    configure();
    retryWatchlistItem(MATRIX.guid);
    globalThis.fetch = realFetch;
    const second = stubServers({ library: [] });
    await syncWatchlist(testContext());
    assert.deepEqual(second.adds, ["603"]);
  });
});

describe("when it should do nothing at all", () => {
  it("makes no request when the feature is off", async () => {
    configure({ enabled: false });
    const calls = stubServers();

    const message = await syncWatchlist(testContext());

    assert.equal(calls.pages, 0, "the poll must not cost a round trip while switched off");
    assert.match(message, /switched off/);
  });

  it("survives plex.tv being unreachable without failing the run", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const message = await syncWatchlist(testContext());

    assert.match(message, /Could not reach plex.tv/);
  });

  it("reads nothing from the library when there is nothing new to check", async () => {
    stubServers({ library: [] });
    await syncWatchlist(testContext());

    // Second run: the only entry is settled, so the expensive half must not
    // happen. A GUID walk every quarter of an hour is the cost this avoids.
    globalThis.fetch = realFetch;
    let sectionReads = 0;
    const calls = stubServers({ library: [] });
    const withCount = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw);
      // Host-scoped deliberately: the watchlist itself lives at
      // `/library/sections/watchlist/all` on plex.tv, so a path-only check
      // counts the one request every run legitimately makes.
      if (url.port === "32400" && url.pathname.startsWith("/library/sections")) sectionReads++;
      return (withCount as typeof fetch)(input, init);
    }) as typeof fetch;

    await syncWatchlist(testContext());

    assert.equal(sectionReads, 0, "no library walk when every entry is already settled");
    assert.deepEqual(calls.adds, []);
  });
});

describe("the ledger's own shape", () => {
  it("keeps first-seen while refreshing what plex.tv reports", async () => {
    stubServers({ library: [] });
    await syncWatchlist(testContext());
    const first = rowFor(MATRIX.guid)!;

    globalThis.fetch = realFetch;
    stubServers({ entries: [{ ...MATRIX, title: "The Matrix (1999)", ratingKey: "rk-new" }], library: [] });
    await syncWatchlist(testContext());
    const second = rowFor(MATRIX.guid)!;

    assert.equal(second.firstSeenAt, first.firstSeenAt, "when we first saw it never moves");
    assert.equal(second.title, "The Matrix (1999)", "but what Plex says about it does");
    assert.equal(second.ratingKey, "rk-new", "including the key a removal would use");
    assert.ok(second.lastSeenAt >= first.lastSeenAt);
  });
});
