import { planWrites } from "./metadata.ts";
import { decodeTags } from "@rube/domain.metadata";
/**
 * The metadata gates.
 *
 * Like cleanup, almost every test here is about something *not* happening —
 * but the reason is different. Cleanup's failure is unrecoverable because the
 * file is gone; this one's is unrecoverable because the value existed nowhere
 * else. A sort title somebody fixed by hand has no source to re-derive it
 * from, so the gates and the snapshot ordering are the whole feature.
 *
 * Plex is stubbed at `fetch`. The stub records every field PUT, so a
 * regression that slips a write past a gate fails on the request rather than
 * on a count that could be satisfied for the wrong reason.
 */
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@rube/core";

import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken } from "@rube/db";
import { ConfigStoreToken } from "@rube/core";
import { config, events, metadataOriginals, rules } from "@rube/db";
import { noopCheckpoint } from "@rube/core";
import { MetadataToken } from "@rube/domain.metadata";
import { createMetadataCommand } from "./metadata.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { batchRows, listBatches, snapshotWrites } = c.resolve(MetadataToken);
const { runHandlerWithMetadata, createMetadataBudget } = createMetadataCommand(services);

const { createPlexClient } = await import("@rube/plex");
type ItemFields = import("@rube/plex").ItemFields;

const RULE_ID = "metadata-rule";
const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

const realFetch = globalThis.fetch;

interface PlexCalls {
  /** Query strings of every section-scoped field PUT. */
  fieldPuts: URLSearchParams[];
}

/** One item as Plex would report it, before anything is written. */
interface StubItem {
  ratingKey: string;
  title: string;
  titleSort?: string;
  studio?: string;
  contentRating?: string;
  year?: number;
  genres?: string[];
  locked?: string[];
}

function stubPlex(items: StubItem[], { sectionTotal = 1000 }: { sectionTotal?: number } = {}): PlexCalls {
  const calls: PlexCalls = { fieldPuts: [] };
  const byKey = new Map(items.map((i) => [i.ratingKey, i]));

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    if (url.pathname === "/") {
      return json({ MediaContainer: { friendlyName: "Test", machineIdentifier: "machine-1" } });
    }
    if (url.pathname === "/library/sections") return json({ MediaContainer: { Directory: SECTIONS } });

    if (url.pathname.startsWith("/library/metadata/")) {
      const key = url.pathname.split("/")[3];
      const item = byKey.get(key);
      if (!item) return json({ MediaContainer: { Metadata: [] } });
      return json({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: item.ratingKey,
              title: item.title,
              type: "movie",
              titleSort: item.titleSort,
              studio: item.studio,
              contentRating: item.contentRating,
              year: item.year,
              Genre: (item.genres ?? []).map((tag) => ({ tag })),
              Field: (item.locked ?? []).map((name) => ({ name, locked: true })),
            },
          ],
        },
      });
    }

    if (url.pathname.startsWith("/library/sections/")) {
      if (method === "PUT") {
        calls.fieldPuts.push(url.searchParams);
        return json({});
      }
      return json({ MediaContainer: { totalSize: sectionTotal, Metadata: [] } });
    }
    return json({ MediaContainer: {} });
  }) as typeof fetch;

  return calls;
}

function testContext(): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

function handlerYielding(items: Array<{ ratingKey: string; title: string }>, name = "Marvel") {
  return async function* () {
    yield { name, section: SECTIONS[0], matched: items };
  } as never;
}

function action(over: Record<string, unknown> = {}) {
  return {
    kind: "metadata" as const,
    lock: true,
    overwriteLocked: false,
    maxWritesPerRun: 200,
    sortLanguages: ["en"],
    dryRun: false,
    ...over,
  } as never;
}

function deps(ctx: JobContext) {
  return {
    ctx,
    client: createPlexClient({ url: "http://plex.test:32400", token: "t" }),
    sections: SECTIONS,
    rule: { id: RULE_ID, name: "Sort titles", type: "smart_filter" },
    ruleConfig: {},
  } as never;
}

/** Query param helper — the params of the nth field PUT. */
function put(calls: PlexCalls, n = 0): Record<string, string> {
  return Object.fromEntries(calls.fieldPuts[n]);
}

beforeEach(() => {
  db.delete(metadataOriginals).run();
  db.delete(events).run();
  db.delete(rules).run();
  db.delete(config).run();
  setConfig("metadata_writes_enabled", true);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("planWrites", () => {
  const item = { ratingKey: "1", sectionId: "1", sectionType: "movie", title: "The Matrix", collection: "Sci-Fi" };
  const current: ItemFields = {
    ratingKey: "1",
    title: "The Matrix",
    type: "movie",
    sectionId: "1",
    sectionType: "movie",
    fields: { title: "The Matrix", titleSort: "The Matrix", year: "1999", studio: "Warner" },
    tags: { genre: ["Action"], label: [] },
    locked: [],
  };

  it("expands a template against the item", () => {
    const [write] = planWrites(action({ set: { titleSort: "{sortableTitle}" } }), item, current);
    assert.equal(write.field, "titleSort");
    assert.equal(write.newValue, "Matrix, The");
  });

  it("resolves {collection} from the group the handler yielded the item under", () => {
    const [write] = planWrites(action({ set: { titleSort: "{collection} {year} {sortableTitle}" } }), item, current);
    assert.equal(write.newValue, "Sci-Fi 1999 Matrix, The");
  });

  it("plans nothing when the value is already right and already locked as asked", () => {
    const already: ItemFields = { ...current, fields: { ...current.fields, studio: "A24" }, locked: ["studio"] };
    assert.deepEqual(planWrites(action({ set: { studio: "A24" } }), item, already), []);
  });

  it("still plans a write when only the lock state differs", () => {
    // The text is right but Plex will revert it on the next agent refresh.
    const planned = planWrites(action({ set: { studio: "Warner" } }), item, current);
    assert.equal(planned.length, 1);
  });

  it("drops a template that expands to nothing rather than blanking the field", () => {
    // A token that didn't resolve should leave the field alone. Writing "" is
    // how a rule quietly erases four hundred summaries.
    const noStudio: ItemFields = { ...current, fields: { title: "The Matrix" } };
    assert.deepEqual(planWrites(action({ set: { summary: "{studio}" } }), item, noStudio), []);
  });

  it("marks a locked field with a different value as blocked", () => {
    const locked: ItemFields = { ...current, fields: { ...current.fields, studio: "Mine" }, locked: ["studio"] };
    const [write] = planWrites(action({ set: { studio: "A24" } }), item, locked);
    assert.equal(write.blocked, true, "a locked field is almost always a human's deliberate fix");
  });

  it("does not block when the rule opts into overwriting locks", () => {
    const locked: ItemFields = { ...current, fields: { ...current.fields, studio: "Mine" }, locked: ["studio"] };
    const [write] = planWrites(action({ set: { studio: "A24" }, overwriteLocked: true }), item, locked);
    assert.equal(write.blocked, false);
  });

  it("adds a tag by resending the whole set", () => {
    // Plex's tag PUT replaces the set; omitting the rest strips every tag the
    // user added by hand.
    const [write] = planWrites(action({ addTags: { genre: ["Cyberpunk"] } }), item, current);
    assert.deepEqual(write.newValue, ["Action", "Cyberpunk"]);
  });

  it("does not add a tag the item already carries", () => {
    assert.deepEqual(planWrites(action({ addTags: { genre: ["action"] } }), item, current), []);
  });

  it("removes a tag case-insensitively", () => {
    const [write] = planWrites(action({ removeTags: { genre: ["ACTION"] } }), item, current);
    assert.deepEqual(write.newValue, []);
  });

  it("plans nothing when a removal names a tag that isn't there", () => {
    assert.deepEqual(planWrites(action({ removeTags: { genre: ["Romance"] } }), item, current), []);
  });
});

describe("guard rails", () => {
  it("writes nothing while the global switch is off", async () => {
    setConfig("metadata_writes_enabled", false);
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx, log } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { titleSort: "{sortableTitle}" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.written, 0);
    assert.equal(calls.fieldPuts.length, 0);
    assert.match(outcome.refusal!, /disabled globally/);
    assert.ok(log.some((l) => l.includes("REFUSING")));
  });

  it("refuses when the rule matched an implausible slice of the library", async () => {
    // The realistic way this feature hurts someone is a smart filter typo.
    const items = Array.from({ length: 300 }, (_, i) => ({ ratingKey: String(i), title: `Film ${i}` }));
    const calls = stubPlex(
      items.map((i) => ({ ratingKey: i.ratingKey, title: i.title })),
      { sectionTotal: 1000 },
    );
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding(items),
    );

    assert.match(outcome.refusal!, /reads as a filter mistake/);
    assert.equal(calls.fieldPuts.length, 0);
  });

  it("refuses when Plex cannot say how large the library is", async () => {
    // Without a denominator the fraction guard has nothing to compare
    // against, and "0 items, so 0% matched" would switch it off at exactly
    // the moment Plex is least trustworthy.
    stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const brokenSizing = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw);
      if (url.pathname === "/library/sections/1/all" && (init?.method ?? "GET") === "GET") {
        throw new Error("Plex is down");
      }
      return brokenSizing(input, init);
    }) as typeof fetch;
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.match(outcome.refusal!, /how large the library is/);
  });

  it("skips a locked field and logs each skip", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix", studio: "Mine", locked: ["studio"] }]);
    const { ctx, log } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.written, 0);
    assert.equal(outcome.blocked, 1);
    assert.equal(calls.fieldPuts.length, 0);
    assert.ok(log.some((l) => l.includes("SKIP") && l.includes("locked")));
  });

  it("stops at the global daily ceiling", async () => {
    setConfig("metadata_max_writes_per_day", 2);
    const items = Array.from({ length: 5 }, (_, i) => ({ ratingKey: String(i), title: `Film ${i}` }));
    const calls = stubPlex(items.map((i) => ({ ratingKey: i.ratingKey, title: i.title })));
    const { ctx, log } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding(items),
    );

    assert.equal(outcome.written, 2);
    assert.equal(calls.fieldPuts.length, 2);
    assert.ok(log.some((l) => l.includes("Daily write limit reached")));
  });

  it("counts writes already in the ledger against the ceiling", async () => {
    // A per-run counter would give every ad-hoc run a fresh full allowance.
    setConfig("metadata_max_writes_per_day", 2);
    snapshotWrites("earlier", RULE_ID, [
      {
        ratingKey: "99",
        sectionId: "1",
        sectionType: "movie",
        itemTitle: "Earlier",
        field: "studio",
        fieldKind: "scalar",
        previousValue: "x",
        previousLocked: false,
        newValue: "y",
      },
    ]);
    const items = Array.from({ length: 3 }, (_, i) => ({ ratingKey: String(i), title: `Film ${i}` }));
    const calls = stubPlex(items.map((i) => ({ ratingKey: i.ratingKey, title: i.title })));
    const { ctx } = testContext();

    await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding(items),
    );

    assert.equal(calls.fieldPuts.length, 1, "one write left in the day's budget");
  });

  it("stops at the rule's own per-run ceiling", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ ratingKey: String(i), title: `Film ${i}` }));
    const calls = stubPlex(items.map((i) => ({ ratingKey: i.ratingKey, title: i.title })));
    const { ctx } = testContext();

    await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" }, maxWritesPerRun: 2 }),
      createMetadataBudget(),
      handlerYielding(items),
    );

    assert.equal(calls.fieldPuts.length, 2);
  });

  it("does nothing at all for an action that sets no fields", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action(),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.matched, 0);
    assert.equal(calls.fieldPuts.length, 0);
  });
});

describe("dry run", () => {
  it("reports the diff and touches nothing", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx, log } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { titleSort: "{sortableTitle}" }, dryRun: true }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.planned, 1);
    assert.equal(outcome.written, 0);
    assert.equal(calls.fieldPuts.length, 0);
    assert.equal(batchRows(outcome.batchId ?? "").length, 0, "a dry run snapshots nothing either");
    assert.ok(log.some((l) => l.includes("would set") && l.includes("Matrix, The")));
  });
});

describe("writing", () => {
  it("writes the field and locks it", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { titleSort: "{sortableTitle}" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.written, 1);
    const params = put(calls);
    assert.equal(params["titleSort.value"], "Matrix, The");
    assert.equal(params["titleSort.locked"], "1");
    assert.equal(params.id, "1");
    assert.equal(params.type, "1");
  });

  it("carries every changed scalar field on one PUT", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx } = testContext();

    await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { titleSort: "{sortableTitle}", studio: "Warner Bros." } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(calls.fieldPuts.length, 1);
    const params = put(calls);
    assert.equal(params["titleSort.value"], "Matrix, The");
    assert.equal(params["studio.value"], "Warner Bros.");
  });

  it("snapshots the previous value and its lock state before writing", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix", studio: "Warner", locked: ["studio"] }]);
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "Warner Bros." }, overwriteLocked: true }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    const [row] = batchRows(outcome.batchId!);
    assert.equal(row.previousValue, "Warner");
    assert.equal(row.previousLocked, 1);
    assert.equal(row.newValue, "Warner Bros.");
    assert.equal(row.ruleId, RULE_ID);
    assert.equal(calls.fieldPuts.length, 1);
  });

  it("keeps the snapshot when the write itself fails", async () => {
    // A partial batch must still be fully revertible — Plex may have applied
    // some of it, and a missing row is worse than a redundant revert.
    stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") throw new Error("Plex refused");
      return inner(input, init);
    }) as typeof fetch;
    const { ctx, log } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(outcome.written, 0);
    assert.equal(listBatches()[0].writes, 1, "the attempt is still recorded");
    assert.ok(log.some((l) => l.includes("FAILED")));
  });

  it("plans an item once even when a grouped rule matched it several times", async () => {
    // A film with three credits is yielded under three groups. Writing it
    // three times would make the second snapshot record the value the first
    // write just made, and the batch would no longer revert to the original.
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix", studio: "Warner" }]);
    const { ctx } = testContext();
    const handler = async function* () {
      yield { name: "Wachowskis", section: SECTIONS[0], matched: [{ ratingKey: "1", title: "The Matrix" }] };
      yield { name: "Warner", section: SECTIONS[0], matched: [{ ratingKey: "1", title: "The Matrix" }] };
    } as never;

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handler,
    );

    assert.equal(outcome.written, 1);
    assert.equal(calls.fieldPuts.length, 1);
    assert.equal(batchRows(outcome.batchId!)[0].previousValue, "Warner");
  });

  it("writes a tag set through the indexed form", async () => {
    const calls = stubPlex([{ ratingKey: "1", title: "The Matrix", genres: ["Action"] }]);
    const { ctx } = testContext();

    const outcome = await runHandlerWithMetadata(
      deps(ctx),
      action({ addTags: { genre: ["Cyberpunk"] } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    const params = put(calls);
    assert.equal(params["genre[0].tag.tag"], "Action");
    assert.equal(params["genre[1].tag.tag"], "Cyberpunk");
    assert.deepEqual(decodeTags(batchRows(outcome.batchId!)[0].previousValue), ["Action"]);
  });

  it("logs one line per field write", async () => {
    // This log is the audit trail people read when something looks wrong.
    const { ctx, log } = testContext();
    stubPlex([{ ratingKey: "1", title: "The Matrix" }]);

    await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { titleSort: "{sortableTitle}", studio: "Warner Bros." } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(log.filter((l) => l.includes("[metadata] SET")).length, 2);
  });

  it("announces the run", async () => {
    stubPlex([{ ratingKey: "1", title: "The Matrix" }]);
    const { ctx } = testContext();

    await runHandlerWithMetadata(
      deps(ctx),
      action({ set: { studio: "A24" } }),
      createMetadataBudget(),
      handlerYielding([{ ratingKey: "1", title: "The Matrix" }]),
    );

    assert.equal(
      db
        .select()
        .from(events)
        .all()
        .filter((e) => e.type === "metadata.written").length,
      1,
    );
  });
});
