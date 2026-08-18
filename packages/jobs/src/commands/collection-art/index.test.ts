/**
 * The `collection-art` command end to end, through real HTTP.
 *
 * The properties worth protecting here are all about *not* doing things: not
 * re-uploading an identical poster to somebody's Plex server every night, not
 * overwriting a description a person wrote by hand, not calling an LLM
 * provider that doesn't exist, and not leaving the ledger claiming work that a
 * cancellation stopped halfway. Each of those is invisible when it regresses —
 * the job still "succeeds" — so they are asserted against what the mock server
 * was actually asked to do rather than against the job's return value.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { noopCheckpoint, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken } from "@tinkerbell/core";
import { DbToken, collectionArtwork, rules } from "@tinkerbell/db";
import { CollectionsToken } from "@tinkerbell/domain.collections";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createCollectionArtCommand } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { deleteConfig, setConfig } = c.resolve(ConfigStoreToken);
const { getCollectionArtwork, recordCollectionArtwork } = c.resolve(CollectionsToken);
const { run } = createCollectionArtCommand(services);

const RULE_ID = "art-rule";
const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

const ITEMS = Array.from({ length: 6 }, (_, i) => ({
  ratingKey: String(100 + i),
  title: `Film ${i}`,
  sectionId: "1",
  guids: [`tmdb://${1000 + i}`],
  labels: [],
  thumb: `/library/metadata/${100 + i}/thumb/1`,
}));

let plex: MockPlex;

interface TestCtx {
  ctx: JobContext;
  log: string[];
  controller: AbortController;
}

function testContext(): TestCtx {
  const lines: string[] = [];
  const controller = new AbortController();
  return {
    log: lines,
    controller,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: controller.signal,
      checkpoint: noopCheckpoint,
    },
  };
}

/** Seed a rule and give it two committed collections in the mock server. */
function seedRule(presentation: Record<string, unknown>): void {
  db.delete(rules).run();
  db.delete(collectionArtwork).run();
  db.insert(rules)
    .values({
      id: RULE_ID,
      name: "By decade",
      type: "decades",
      enabled: 1,
      createdAt: Date.now(),
      config: { pinToHomepage: false, presentation },
    })
    .run();
}

function seedCollections(names: string[]): void {
  let key = 9000;
  for (const title of names) {
    const ratingKey = String(key++);
    plex.collections.set(ratingKey, {
      ratingKey,
      title,
      sectionId: "1",
      labels: ["Tinkerbell", `Rule:${RULE_ID}`],
      memberKeys: ITEMS.map((i) => i.ratingKey),
      summary: "",
    });
  }
}

/**
 * A minimal OpenAI-compatible endpoint.
 *
 * Spoken to over real HTTP through the real `@tinkerbell/llm` client, because
 * the property under test is "how many times did we actually call the
 * provider" — and a stubbed client is exactly the thing that would answer that
 * question from the wrong side of the cache.
 */
async function startMockLlm(opts: { status?: number } = {}): Promise<{
  origin: string;
  calls: string[];
  close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls.push(body);
      if (opts.status && opts.status >= 400) {
        res.writeHead(opts.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "provider is down" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: "A decade of films worth remembering." } }],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

before(async () => {
  plex = await startMockPlex({ sections: SECTIONS, items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
});

after(async () => {
  await plex?.close();
});

beforeEach(() => {
  plex.collections.clear();
  plex.journal.posterUploads.length = 0;
  plex.journal.summaryWrites.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("collection_art_enabled", true);
  // No provider configured, unless a test says otherwise.
  deleteConfig("global_llm");
  deleteConfig("global_anthropic_api_key");
  db.delete(rules).run();
  db.delete(collectionArtwork).run();
});

describe("collection-art", () => {
  it("uploads a poster per collection, and records what it uploaded", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s", "1990s"]);

    const { ctx } = testContext();
    await run(ctx, {});

    assert.equal(plex.journal.posterUploads.length, 2, "one upload per collection");
    for (const upload of plex.journal.posterUploads) {
      assert.ok(upload.bytes > 1000, "a real JPEG, not an empty body");
    }
    const ledger = getCollectionArtwork(RULE_ID, "1980s");
    assert.ok(ledger?.posterUploadedAt, "upload recorded");
    assert.ok(ledger?.inputHash, "input hash recorded");
  });

  it("skips the upload on a second run when nothing about the inputs changed", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s", "1990s"]);

    await run(testContext().ctx, {});
    assert.equal(plex.journal.posterUploads.length, 2);

    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.equal(plex.journal.posterUploads.length, 2, "the second run must upload nothing");
    assert.match(log.join("\n"), /2 unchanged/);
  });

  it("re-uploads when forced, for the poster somebody replaced by hand", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s"]);

    await run(testContext().ctx, {});
    await run(testContext().ctx, { force: true });
    assert.equal(plex.journal.posterUploads.length, 2, "force ignores the unchanged hash");
  });

  it("re-uploads when the member art changes, because that changes the poster", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s"]);
    await run(testContext().ctx, {});
    assert.equal(plex.journal.posterUploads.length, 1);

    // Plex mints a new thumb path whenever the artwork behind it changes,
    // which is exactly the signal the input hash is built on.
    const first = plex.items.get("100")!;
    first.thumb = "/library/metadata/100/thumb/2";

    await run(testContext().ctx, {});
    assert.equal(plex.journal.posterUploads.length, 2, "new member art must produce a new poster");
  });

  it("leaves a poster somebody chose in the app alone, even when forced", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s"]);

    await run(testContext().ctx, {});
    assert.equal(plex.journal.posterUploads.length, 1);

    // What the poster studio records when a person picks, uploads or renders
    // one by hand. The blank input hash is part of it: without the lock, that
    // alone would make the next run believe it had work to do.
    recordCollectionArtwork(RULE_ID, "1980s", { posterLockedAt: Date.now(), inputHash: "" });

    const { ctx, log } = testContext();
    await run(ctx, { force: true });
    assert.equal(plex.journal.posterUploads.length, 1, "a locked poster must survive even a forced run");
    assert.match(log.join("\n"), /1 left alone \(chosen by hand\)/);
  });

  it("records the artwork a collection already had, once, for the revert affordance", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s"]);
    plex.collections.get("9000")!.thumb = "/library/metadata/9000/thumb/original";

    await run(testContext().ctx, {});
    assert.equal(getCollectionArtwork(RULE_ID, "1980s")?.priorThumb, "/library/metadata/9000/thumb/original");

    // The second run sees *our* poster on the collection. It must not mistake
    // that for what was there before.
    await run(testContext().ctx, { force: true });
    assert.equal(getCollectionArtwork(RULE_ID, "1980s")?.priorThumb, "/library/metadata/9000/thumb/original");
  });

  it("does nothing at all when the master switch is off", async () => {
    seedRule({ poster: "mosaic" });
    seedCollections(["1980s"]);
    setConfig("collection_art_enabled", false);

    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.equal(plex.journal.posterUploads.length, 0);
    assert.match(log.join("\n"), /switched off/i);
  });

  it("ignores a rule that hasn't opted in", async () => {
    seedRule({});
    seedCollections(["1980s"]);

    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.equal(plex.journal.posterUploads.length, 0);
    assert.match(log.join("\n"), /nothing to do/i);
  });

  describe("summaries", () => {
    it("skips the LLM path entirely with no provider configured", async () => {
      seedRule({ summary: "llm", poster: "none" });
      seedCollections(["1980s"]);

      const { ctx } = testContext();
      await run(ctx, {});

      assert.equal(plex.journal.summaryWrites.length, 0, "no provider means no summary write");
      assert.equal(getCollectionArtwork(RULE_ID, "1980s")?.summarySource ?? "", "");
    });

    it("detects a summary edited in Plex and stops writing that one", async () => {
      seedRule({ poster: "mosaic" });
      seedCollections(["1980s"]);
      // Stand in for the commit-time write: the ledger says what we last wrote.
      recordCollectionArtwork(RULE_ID, "1980s", {
        summary: "Films released between 1980 and 1989.",
        summarySource: "template",
      });
      plex.collections.get("9000")!.summary = "My own words about the eighties.";

      const { ctx, log } = testContext();
      await run(ctx, {});

      const ledger = getCollectionArtwork(RULE_ID, "1980s");
      assert.ok(ledger?.summaryLockedAt, "the edit should have been noticed and locked");
      assert.equal(ledger?.summary, "Films released between 1980 and 1989.", "our last write is kept as the record");
      assert.equal(plex.collections.get("9000")!.summary, "My own words about the eighties.", "left untouched");
      assert.match(log.join("\n"), /edited in Plex/);
    });

    it("does not mistake its own summary for an edit", async () => {
      seedRule({ poster: "mosaic" });
      seedCollections(["1980s"]);
      recordCollectionArtwork(RULE_ID, "1980s", { summary: "Ours.", summarySource: "template" });
      plex.collections.get("9000")!.summary = "Ours.";

      await run(testContext().ctx, {});
      assert.equal(getCollectionArtwork(RULE_ID, "1980s")?.summaryLockedAt, null);
    });

    it("writes once, then reuses the cached text until the rule config changes", async () => {
      const llm = await startMockLlm();
      try {
        setConfig("global_llm", {
          provider: "openai-compatible",
          model: "test-model",
          baseUrl: `${llm.origin}/v1`,
        });
        seedRule({ summary: "llm", poster: "none" });
        seedCollections(["1980s"]);

        await run(testContext().ctx, {});
        assert.equal(llm.calls.length, 1, "one call for one collection");
        assert.equal(plex.collections.get("9000")!.summary, "A decade of films worth remembering.");

        // Same rule config, second run: the cache must hold. The summary is
        // still re-asserted on Plex, because the collection is deleted and
        // recreated by every rule run.
        plex.collections.get("9000")!.summary = "";
        await run(testContext().ctx, {});
        assert.equal(llm.calls.length, 1, "an unchanged rule must not pay for a second call");
        assert.equal(plex.collections.get("9000")!.summary, "A decade of films worth remembering.");

        // Change the rule's config and the cached text no longer describes it.
        db.update(rules)
          .set({ config: { pinToHomepage: false, minItems: 5, presentation: { summary: "llm", poster: "none" } } })
          .run();
        await run(testContext().ctx, {});
        assert.equal(llm.calls.length, 2, "a changed config must miss the cache");
      } finally {
        await llm.close();
      }
    });

    it("falls back to what is already there when the provider fails", async () => {
      const llm = await startMockLlm({ status: 503 });
      try {
        setConfig("global_llm", {
          provider: "openai-compatible",
          model: "test-model",
          baseUrl: `${llm.origin}/v1`,
        });
        seedRule({ summary: "llm", poster: "none" });
        seedCollections(["1980s"]);
        plex.collections.get("9000")!.summary = "Films released between 1980 and 1989.";

        const { ctx, log } = testContext();
        await run(ctx, {});

        assert.match(log.join("\n"), /AI summary for "1980s" failed/);
        assert.equal(
          plex.collections.get("9000")!.summary,
          "Films released between 1980 and 1989.",
          "the templated summary written at commit time survives a provider outage",
        );
      } finally {
        await llm.close();
      }
    });

    it("does not lock a collection it has never described", async () => {
      seedRule({ poster: "mosaic" });
      seedCollections(["1980s"]);
      plex.collections.get("9000")!.summary = "Something Plex or another tool wrote.";

      await run(testContext().ctx, {});
      assert.equal(getCollectionArtwork(RULE_ID, "1980s")?.summaryLockedAt, null);
    });
  });

  describe("cancellation", () => {
    it("stops promptly between collections and leaves a consistent ledger", async () => {
      seedRule({ poster: "mosaic" });
      seedCollections(["1980s", "1990s", "2000s", "2010s"]);

      const { ctx, controller } = testContext();
      // Abort as soon as the first poster has landed. Everything after it must
      // be untouched, and nothing may be recorded as done that wasn't.
      const originalLength = plex.journal.posterUploads.length;
      const poll = setInterval(() => {
        if (plex.journal.posterUploads.length > originalLength) {
          controller.abort();
          clearInterval(poll);
        }
      }, 1);

      await assert.rejects(() => run(ctx, {}));
      clearInterval(poll);

      const rows = db.select().from(collectionArtwork).all();
      assert.ok(rows.length < 4, "a cancelled run must not have finished every collection");

      // The ledger may lag the server by one — an abort can land between the
      // upload arriving and the row being written, and there is no way to make
      // those two atomic across a network. What must never happen is the other
      // direction: a row claiming an upload the server never received would
      // make the next run skip a collection that has no artwork on it, and
      // nothing would ever notice.
      const claimed = rows.filter((r) => r.posterUploadedAt).length;
      assert.ok(
        claimed <= plex.journal.posterUploads.length,
        `ledger claims ${claimed} upload(s) but the server saw ${plex.journal.posterUploads.length}`,
      );

      // And the run after the cancellation puts the library right, whichever
      // side of that race it stopped on.
      await run(testContext().ctx, {});
      const after = db.select().from(collectionArtwork).all();
      assert.equal(after.filter((r) => r.posterUploadedAt).length, 4, "a resumed run finishes the job");
    });
  });
});
