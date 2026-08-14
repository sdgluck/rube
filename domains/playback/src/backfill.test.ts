/**
 * Termination tests for the history page walk.
 *
 * This is where an off-by-one silently truncates someone's imported history,
 * so it drives the real `historyPages` generator with a fake pager rather than
 * a reimplementation of the loop. The DB half (dedupe, rollup) needs a migrated
 * database and is exercised separately.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PlexHistoryItem } from "@tinkerbell/plex";
import { historyPages, type HistoryPager } from "./backfill.ts";

function entry(over: Partial<PlexHistoryItem> = {}): PlexHistoryItem {
  return { type: "movie", ratingKey: "100", title: "The Matrix", accountID: 7, viewedAt: 1_700_000_000, ...over };
}

/** A pager that serves canned pages and records the requests it received. */
function pagerOf(pages: PlexHistoryItem[][]) {
  const calls: { limit: number; offset: number; viewedAfter?: number }[] = [];
  const fetchPage: HistoryPager = async (opts) => {
    calls.push(opts);
    return pages[calls.length - 1] ?? [];
  };
  return { fetchPage, calls };
}

async function collect(gen: AsyncGenerator<PlexHistoryItem[]>): Promise<PlexHistoryItem[]> {
  const out: PlexHistoryItem[] = [];
  for await (const page of gen) out.push(...page);
  return out;
}

describe("historyPages", () => {
  test("a short first page terminates after one request", async () => {
    const { fetchPage, calls } = pagerOf([[entry(), entry({ ratingKey: "101" })]]);
    const items = await collect(historyPages(fetchPage, { pageSize: 500 }));
    assert.equal(calls.length, 1);
    assert.equal(items.length, 2);
  });

  test("a full page is followed by another request at the next offset", async () => {
    const full = [entry({ ratingKey: "1" }), entry({ ratingKey: "2" }), entry({ ratingKey: "3" })];
    const { fetchPage, calls } = pagerOf([full, [entry({ ratingKey: "4" })]]);
    const items = await collect(historyPages(fetchPage, { pageSize: 3 }));
    assert.deepEqual(
      calls.map((c) => c.offset),
      [0, 3],
    );
    assert.equal(items.length, 4);
  });

  test("an exactly-full final page terminates on the following empty one", async () => {
    // The nastiest case: no short page ever arrives, so termination depends on
    // the empty response rather than a partial one.
    const full = [entry({ ratingKey: "1" }), entry({ ratingKey: "2" })];
    const { fetchPage, calls } = pagerOf([full, full, []]);
    const items = await collect(historyPages(fetchPage, { pageSize: 2 }));
    assert.equal(calls.length, 3);
    assert.equal(items.length, 4);
  });

  test("an empty history makes exactly one request and yields nothing", async () => {
    const { fetchPage, calls } = pagerOf([[]]);
    const items = await collect(historyPages(fetchPage, { pageSize: 500 }));
    assert.equal(calls.length, 1);
    assert.equal(items.length, 0);
  });

  test("the page ceiling bounds a server that never returns a short page", async () => {
    // Without this a misbehaving endpoint walks forever.
    const full = [entry({ ratingKey: "1" })];
    const fetchPage: HistoryPager = async () => full;
    const items = await collect(historyPages(fetchPage, { pageSize: 1, maxPages: 4 }));
    assert.equal(items.length, 4);
  });

  test("an aborted signal stops the walk", async () => {
    const controller = new AbortController();
    const full = [entry({ ratingKey: "1" }), entry({ ratingKey: "2" })];
    const fetchPage: HistoryPager = async () => {
      controller.abort();
      return full;
    };
    const items = await collect(historyPages(fetchPage, { pageSize: 2, signal: controller.signal }));
    // The in-flight page is still yielded; the next iteration is what stops.
    assert.equal(items.length, 2);
  });

  test("viewedAfter is forwarded to every page request", async () => {
    const full = [entry({ ratingKey: "1" })];
    const { fetchPage, calls } = pagerOf([full, []]);
    await collect(historyPages(fetchPage, { pageSize: 1, viewedAfter: 1_700_000_000 }));
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((c) => c.viewedAfter === 1_700_000_000));
  });
});

describe("history timestamps", () => {
  test("viewedAt is Unix seconds and must be scaled to milliseconds", () => {
    // Plex's history endpoint is the only place in this codebase using seconds.
    // Getting it wrong dates every imported play to January 1970.
    const seconds = 1_700_000_000;
    assert.equal(new Date(seconds * 1000).getUTCFullYear(), 2023);
    assert.equal(new Date(seconds).getUTCFullYear(), 1970);
  });
});
