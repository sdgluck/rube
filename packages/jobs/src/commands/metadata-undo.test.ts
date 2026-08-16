/**
 * Undo is what makes the metadata action tolerable, so the properties tested
 * here are the ones that decide whether the promise holds: a batch restores
 * values *and* lock states, a run that failed halfway is still fully
 * revertible, and undoing twice is a no-op rather than a double-revert.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";

setupTempDb("tinkerbell-metadata-undo-test-");

const { db, config, metadataOriginals } = await import("@tinkerbell/db");
const { setConfig, getConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { snapshotWrites, batchRows, listBatches } = await import("@tinkerbell/domain.metadata");
const undo = (await import("./metadata-undo.ts")).default;

const BATCH = "batch-1";

interface PlexCalls {
  puts: URLSearchParams[];
}

function stubPlex(): PlexCalls {
  const calls: PlexCalls = { puts: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    if (url.pathname === "/") return json({ MediaContainer: { machineIdentifier: "m" } });
    if (method === "PUT") {
      calls.puts.push(url.searchParams);
      return json({});
    }
    if (url.pathname.startsWith("/library/metadata/")) {
      // Whatever the rule wrote is what is there now — so nothing the undo
      // restores is ever a no-op the client would skip.
      return json({
        MediaContainer: {
          Metadata: [{ ratingKey: "1", title: "The Matrix", type: "movie", studio: "A24", titleSort: "Matrix, The" }],
        },
      });
    }
    return json({ MediaContainer: {} });
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;

function testContext(): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

function snapshot(over: Partial<Parameters<typeof snapshotWrites>[2][number]> = {}) {
  return {
    ratingKey: "1",
    sectionId: "1",
    sectionType: "movie",
    itemTitle: "The Matrix",
    field: "studio",
    fieldKind: "scalar" as const,
    previousValue: "Warner",
    previousLocked: false,
    newValue: "A24",
    ...over,
  };
}

/** Params of the nth PUT, flattened. */
function put(calls: PlexCalls, n = 0): Record<string, string> {
  return Object.fromEntries(calls.puts[n]);
}

beforeEach(() => {
  db.delete(metadataOriginals).run();
  db.delete(config).run();
  setConfig("global_plex_url", "http://plex.test:32400");
  setConfig("global_plex_token", "t");
  setConfig("metadata_undo_pending_batch", BATCH);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("metadata-undo", () => {
  it("restores the previous value", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot()]);
    const calls = stubPlex();
    const { ctx } = testContext();

    await undo(ctx, {});

    assert.equal(put(calls)["studio.value"], "Warner");
    assert.equal(batchRows(BATCH).length, 0);
  });

  it("restores the previous lock state, not just the value", async () => {
    // Putting the text back while leaving the field locked hands back a field
    // Plex has stopped maintaining — a revert that isn't one.
    snapshotWrites(BATCH, "rule-1", [snapshot({ previousLocked: false })]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(put(calls)["studio.locked"], "0");
  });

  it("keeps a field that was locked before the run locked", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot({ previousLocked: true })]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(put(calls)["studio.locked"], "1");
  });

  it("clears and unlocks a field that had no value before", async () => {
    // Plex has no "forget this value" verb; clearing and unlocking is the
    // closest inverse, and lets the next agent refresh refill it.
    snapshotWrites(BATCH, "rule-1", [snapshot({ field: "tagline", previousValue: null, newValue: "Free your mind" })]);
    const calls = stubPlex();
    const { log } = testContext();
    const ctx = testContext();

    await undo(ctx.ctx, {});

    const params = calls.puts.map((p) => Object.fromEntries(p));
    assert.ok(params.some((p) => p["tagline.locked"] === "0"));
    assert.ok(params.every((p) => p["tagline.value"] === undefined || p["tagline.value"] === ""));
    assert.ok(ctx.log.some((l) => l.includes("handed back to Plex")));
    void log;
  });

  it("splits one item's fields by their previous lock state", async () => {
    // A single PUT carries one lock flag per field, but `updateItemFields`
    // takes one intent for the call — so rows that were locked and rows that
    // weren't cannot ride together.
    snapshotWrites(BATCH, "rule-1", [
      snapshot({ field: "studio", previousLocked: true }),
      snapshot({ field: "titleSort", previousValue: "The Matrix", previousLocked: false }),
    ]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(calls.puts.length, 2);
  });

  it("restores a tag set", async () => {
    snapshotWrites(BATCH, "rule-1", [
      snapshot({
        field: "genre",
        fieldKind: "tag",
        previousValue: ["Action", "Sci-Fi"],
        newValue: ["Action", "Sci-Fi", "Cyberpunk"],
      }),
    ]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    const params = put(calls);
    assert.equal(params["genre[0].tag.tag"], "Action");
    assert.equal(params["genre[1].tag.tag"], "Sci-Fi");
    assert.ok(!("genre[2].tag.tag" in params));
  });

  it("reverts a batch whose run died halfway", async () => {
    // The rows are written before the Plex call, so a batch that failed
    // partway has snapshots for writes that may or may not have landed. All
    // of them are restorable, and restoring one that never happened is
    // harmless.
    snapshotWrites(BATCH, "rule-1", [snapshot(), snapshot({ ratingKey: "2", itemTitle: "Heat" })]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(calls.puts.length, 2);
    assert.equal(listBatches()[0].reverted, true);
  });

  it("is a no-op the second time", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot()]);
    stubPlex();
    await undo(testContext().ctx, {});

    setConfig("metadata_undo_pending_batch", BATCH);
    const calls = stubPlex();
    const { ctx, log } = testContext();
    await undo(ctx, {});

    assert.equal(calls.puts.length, 0);
    assert.ok(log.some((l) => l.includes("nothing left to revert")));
  });

  it("restores the value from before the first of two writes to one field", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot({ previousValue: "Warner", newValue: "WB" })]);
    snapshotWrites(BATCH, "rule-1", [snapshot({ previousValue: "WB", newValue: "A24" })]);
    const calls = stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(put(calls)["studio.value"], "Warner", "not the value written in between");
    assert.equal(batchRows(BATCH).length, 0, "both rows are spent");
  });

  it("leaves rows undoable when Plex refuses", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot()]);
    stubPlex();
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") throw new Error("Plex refused");
      return inner(input, init);
    }) as typeof fetch;
    const { ctx, log } = testContext();

    await undo(ctx, {});

    assert.equal(batchRows(BATCH).length, 1, "a row marked reverted that wasn't is unrecoverable");
    assert.ok(log.some((l) => l.includes("Failed to revert")));
  });

  it("clears the pending slot so a later run doesn't repeat it", async () => {
    snapshotWrites(BATCH, "rule-1", [snapshot()]);
    stubPlex();

    await undo(testContext().ctx, {});

    assert.equal(getConfig("metadata_undo_pending_batch"), undefined);
  });

  it("does nothing when no batch is selected", async () => {
    setConfig("metadata_undo_pending_batch", "");
    const calls = stubPlex();
    const { ctx, log } = testContext();

    await undo(ctx, {});

    assert.equal(calls.puts.length, 0);
    assert.ok(log.some((l) => l.includes("No batch selected")));
  });
});
