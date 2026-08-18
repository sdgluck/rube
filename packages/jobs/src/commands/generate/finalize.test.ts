/**
 * What a commit writes onto a collection besides its members.
 *
 * The summary is written here — inside the rule run — rather than deferred to
 * `collection-art`, because it is one PUT with no CPU behind it and a
 * collection that gains its description the moment it exists is the whole
 * difference the feature makes. That makes this the place where the two ways
 * it could go wrong live: writing a description onto something that shouldn't
 * have one, and overwriting one a person wrote.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";
import type { JobContext } from "@tinkerbell/core";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";

setupTempDb("tinkerbell-finalize-");

const { db, collectionArtwork, rules } = await import("@tinkerbell/db");
const { setConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { getCollectionArtwork, recordCollectionArtwork } = await import("@tinkerbell/domain.collections");
const { createPlexClient } = await import("@tinkerbell/plex");
const { startMockPlex, MACHINE_ID } = await import("../../test-support/mock-plex-server.ts");
const { commitCollection } = await import("./finalize.ts");

const RULE_ID = "finalize-rule";
const SECTION = { key: "1", title: "Films", type: "movie" };
const ITEMS = [
  { ratingKey: "100", title: "Memento", sectionId: "1", guids: [], labels: [] },
  { ratingKey: "101", title: "Inception", sectionId: "1", guids: [], labels: [] },
];

let plex: MockPlex;

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

function client() {
  return createPlexClient({ url: plex.origin, token: "test-token" });
}

async function commit(
  ctx: JobContext,
  opts: {
    name?: string;
    ruleId?: string;
    ruleType?: string;
    ruleConfig?: Record<string, unknown>;
    sourceSummary?: string;
  } = {},
): Promise<string | null> {
  return commitCollection(ctx, client(), {
    section: SECTION,
    machineId: MACHINE_ID,
    name: opts.name ?? "Christopher Nolan",
    ratingKeys: ITEMS.map((i) => i.ratingKey),
    labels: ["Tinkerbell", `Rule:${RULE_ID}`],
    ruleType: opts.ruleType ?? "directors",
    ruleId: "ruleId" in opts ? opts.ruleId : RULE_ID,
    ruleConfig: opts.ruleConfig,
    sourceSummary: opts.sourceSummary,
  });
}

before(async () => {
  plex = await startMockPlex({ sections: [SECTION], items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  // Kometa auto-posters would add an outbound fetch per commit; this feature
  // is not what's under test here.
  setConfig("posters_kometa_enabled", false);
});

after(async () => {
  await plex?.close();
});

beforeEach(() => {
  plex.collections.clear();
  plex.journal.summaryWrites.length = 0;
  db.delete(collectionArtwork).run();
  db.delete(rules).run();
  // The ledger has a foreign key onto `rules`, so the rule has to exist before
  // anything can be recorded against it.
  db.insert(rules)
    .values({ id: RULE_ID, name: "By director", type: "directors", enabled: 1, createdAt: Date.now(), config: {} })
    .run();
});

describe("commitCollection — summaries", () => {
  it("describes the collection it just built, from the rule type", async () => {
    const { ctx } = testContext();
    const key = await commit(ctx);
    assert.ok(key);
    assert.equal(plex.collections.get(key!)!.summary, "Films directed by Christopher Nolan.");
    const ledger = getCollectionArtwork(RULE_ID, "Christopher Nolan");
    assert.equal(ledger?.summary, "Films directed by Christopher Nolan.");
    assert.equal(ledger?.summarySource, "template");
  });

  it("prefers the summary the source published", async () => {
    const { ctx } = testContext();
    const key = await commit(ctx, {
      ruleType: "tmdb_franchises",
      name: "The Matrix Collection",
      sourceSummary: "A cycle of films about a simulated reality.",
    });
    assert.equal(plex.collections.get(key!)!.summary, "A cycle of films about a simulated reality.");
  });

  it("writes the custom text when the rule asks for one", async () => {
    const { ctx } = testContext();
    const key = await commit(ctx, {
      ruleConfig: { presentation: { summary: "custom", customSummary: "The good stuff." } },
    });
    assert.equal(plex.collections.get(key!)!.summary, "The good stuff.");
    assert.equal(getCollectionArtwork(RULE_ID, "Christopher Nolan")?.summarySource, "custom");
  });

  it("writes nothing when the rule turns summaries off", async () => {
    const { ctx } = testContext();
    await commit(ctx, { ruleConfig: { presentation: { summary: "none" } } });
    assert.equal(plex.journal.summaryWrites.length, 0);
  });

  it("writes nothing for a rule type with no honest sentence to write", async () => {
    const { ctx } = testContext();
    await commit(ctx, { ruleType: "ai_prompt", name: "Slow Burn Thrillers" });
    assert.equal(plex.journal.summaryWrites.length, 0);
  });

  it("writes nothing for the cleanup shelf, which belongs to no rule's presentation", async () => {
    const { ctx } = testContext();
    await commit(ctx, { ruleId: undefined, ruleType: "cleanup", name: "Reclaim space" });
    assert.equal(plex.journal.summaryWrites.length, 0);
  });

  it("leaves a summary alone once somebody has been seen editing it", async () => {
    // The lock is set by `collection-art`, which is what reads the live value.
    // Honouring it here is what makes the very next nightly run stop.
    recordCollectionArtwork(RULE_ID, "Christopher Nolan", {
      summary: "Films directed by Christopher Nolan.",
      summarySource: "template",
      summaryLockedAt: Date.now(),
    });

    const { ctx, log } = testContext();
    await commit(ctx);
    assert.equal(plex.journal.summaryWrites.length, 0, "a locked summary must not be rewritten");
    assert.match(log.join("\n"), /edited in Plex/);
  });

  it("still returns the collection when the summary write fails", async () => {
    // A description is a nicety. Failing to set one must not fail the commit,
    // or a Plex hiccup on a PUT would cost the collection itself.
    const { ctx, log } = testContext();
    const brokenClient = createPlexClient({ url: plex.origin, token: "test-token" });
    const original = brokenClient.updateCollection;
    brokenClient.updateCollection = async () => {
      throw new Error("Plex said no");
    };
    try {
      const key = await commitCollection(ctx, brokenClient, {
        section: SECTION,
        machineId: MACHINE_ID,
        name: "Christopher Nolan",
        ratingKeys: ITEMS.map((i) => i.ratingKey),
        labels: ["Tinkerbell", `Rule:${RULE_ID}`],
        ruleType: "directors",
        ruleId: RULE_ID,
      });
      assert.ok(key, "the collection is still committed");
      assert.match(log.join("\n"), /Summary update failed/);
    } finally {
      brokenClient.updateCollection = original;
    }
  });
});
