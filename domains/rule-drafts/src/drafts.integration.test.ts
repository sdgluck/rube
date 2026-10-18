/**
 * A draft end to end: the library's real genres from a mock Plex, the model
 * stood in for by a client that answers what a model plausibly would, and
 * the usage ledger the real wrapper writes.
 *
 * The model is faked at the `LlmClient` boundary rather than over HTTP: what
 * is under test is what Tinkerbell does with an answer, and the provider
 * clients have their own wire tests.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "@tinkerbell/db/test-db";
import { llmUsage, plexUsers } from "@tinkerbell/db";
import { createConfigStore } from "@tinkerbell/core";
import { createAiUsage } from "@tinkerbell/domain.ai-usage";
import { createPlexClient, type PlexClient } from "@tinkerbell/plex";
import type { LlmClient, LlmRequest } from "@tinkerbell/llm";
import { startMockPlex, type MockPlex } from "@tinkerbell/test-support";
import { createRuleDrafts, extractJson } from "./index.ts";

describe("draftSmartFilter", () => {
  let t: TestDb;
  let plex: MockPlex;
  let prompts: LlmRequest[];
  let answer: string;

  async function setup(opts: { llm?: boolean } = {}) {
    plex = await startMockPlex({
      sections: [{ key: "1", title: "Films", type: "movie" }],
      items: [
        { ratingKey: "1", title: "Heat", sectionId: "1", guids: [], labels: [], genre: "Action" },
        { ratingKey: "2", title: "Airplane!", sectionId: "1", guids: [], labels: [], genre: "Comedy" },
      ],
    });
    t.db
      .insert(plexUsers)
      .values({ userId: 7, username: "alex", label: "alex", syncedAt: 0, isOwner: 0, sharedServerId: 1 })
      .run();
    const config = createConfigStore({ db: t.db, recordChange: () => {} });
    if (opts.llm !== false)
      config.setConfig("global_llm", { provider: "ollama", model: "fake", baseUrl: "http://llm" });
    const fake: LlmClient = {
      provider: "ollama",
      model: "fake",
      async complete(req) {
        prompts.push(req);
        return { text: answer, tokensIn: 900, tokensOut: 60, model: "fake", provider: "ollama" };
      },
      async ping() {
        throw new Error("not used");
      },
    };
    return createRuleDrafts({
      db: t.db,
      config,
      aiUsage: createAiUsage({ db: t.db, config, now: () => Date.now() }),
      plex: (o): PlexClient => createPlexClient({ url: plex.origin, token: "t", signal: o?.signal }),
      now: () => Date.parse("2026-10-18T12:00:00Z"),
      llmClient: () => fake,
    });
  }

  beforeEach(() => {
    t = createTestDb();
    prompts = [];
  });
  afterEach(async () => {
    await plex?.close();
    t.dispose();
  });

  it("drafts a filter from the library's own genres, and records the call", async () => {
    const drafts = await setup();
    answer =
      "```json\n" +
      JSON.stringify({
        combinator: "all",
        clauses: [
          { field: "genre", op: "=", value: "action" },
          { field: "duration", op: "<", value: "2h" },
          { field: "tb.watchedBy", op: "!=", value: "alex" },
          { field: "studio", op: "=", value: "Warner Bros." },
        ],
        unsupported: ["slow burn"],
      }) +
      "\n```";

    const result = await drafts.draftSmartFilter({
      description: "action under two hours alex hasn't seen",
      sectionId: "1",
    });

    assert.deepEqual(result.filter.children, [
      { kind: "leaf", field: "genre", op: "=", value: "Action" },
      { kind: "leaf", field: "duration", op: "<", value: "7200000" },
      { kind: "leaf", field: "tb.watchedBy", op: "!=", value: "7" },
    ]);
    // The mock serves no studio facet, so a studio can't be checked and is dropped.
    assert.ok(result.notes.some((n) => /no studio called that/.test(n)));
    assert.ok(result.notes.some((n) => /slow burn/.test(n)));

    const prompt = prompts[0].prompt;
    assert.match(prompt, /Values in this library: Action, Comedy\./);
    assert.match(prompt, /Users: alex\./);
    assert.match(prompt, /Today is 2026-10-18/);
    assert.match(prompt, /<description>\naction under two hours alex hasn't seen\n<\/description>/);

    const usage = t.db.select().from(llmUsage).all();
    assert.equal(usage.length, 1);
    assert.equal(usage[0].feature, "rule-draft");
  });

  it("refuses when nothing survives, passing on why", async () => {
    const drafts = await setup();
    answer = JSON.stringify({ combinator: "all", clauses: [{ field: "mood", op: "=", value: "cosy" }] });
    await assert.rejects(
      drafts.draftSmartFilter({ description: "something cosy", sectionId: "1" }),
      (err: Error & { notes?: string[] }) =>
        /Nothing in that description/.test(err.message) && /isn't a field/.test(err.notes?.[0] ?? ""),
    );
  });

  it("says plainly when the answer isn't JSON", async () => {
    const drafts = await setup();
    answer = "I'm sorry, I can't help with that.";
    await assert.rejects(drafts.draftSmartFilter({ description: "anything", sectionId: "1" }), /wasn't a filter/);
  });

  it("is unavailable without a provider, and says where to set one", async () => {
    const drafts = await setup({ llm: false });
    assert.match(drafts.unavailableReason() ?? "", /Settings → AI/);
    await assert.rejects(drafts.draftSmartFilter({ description: "anything", sectionId: "1" }), /Settings → AI/);
    assert.equal(prompts.length, 0);
  });

  it("refuses a library Plex doesn't have", async () => {
    const drafts = await setup();
    await assert.rejects(drafts.draftSmartFilter({ description: "anything", sectionId: "9" }), /no longer in Plex/);
  });
});

describe("extractJson", () => {
  it("finds the object in a fenced or prefixed reply", () => {
    assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
    assert.equal(extractJson("no json here"), null);
    assert.equal(extractJson("{broken"), null);
  });
});
