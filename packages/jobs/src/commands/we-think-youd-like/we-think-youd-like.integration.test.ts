/**
 * We Think You'd Like end to end, through real HTTP to a mock Plex and a mock
 * OpenAI-compatible provider.
 *
 * What's protected is mostly what the job must *not* do: recommend something
 * the person has already seen, replace a row it could have edited, empty a
 * good row because one answer was bad, or touch Because You Watched's rows on
 * the way out. Each is asserted against what the servers were asked to do.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { noopCheckpoint, ConfigStoreToken, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, llmUsage, playbackSessions, plexUsers } from "@tinkerbell/db";
import { startMockPlex, type MockPlex } from "../../test-support/mock-plex-server.ts";
import { createWeThinkYoudLikeCommand, WTYL_LABEL } from "./index.ts";
import { createWtylRemoveCommand } from "../wtyl-remove.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { deleteConfig, setConfig } = c.resolve(ConfigStoreToken);
const { run } = createWeThinkYoudLikeCommand(services);
const { run: remove } = createWtylRemoveCommand(services);

const ITEMS = Array.from({ length: 20 }, (_, i) => ({
  ratingKey: String(100 + i),
  title: `Film ${i}`,
  year: 2000 + i,
  sectionId: "1",
  guids: [],
  labels: [],
}));
const label = (i: number) => `Film ${i} (${2000 + i})`;
const CONFIG = { minItems: 5, maxItems: 6 };

let plex: MockPlex;
let llm: { origin: string; calls: string[]; answer: string; close: () => Promise<void> };

async function startMockLlm(): Promise<typeof llm> {
  const state = { calls: [] as string[], answer: "" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      state.calls.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: state.answer } }],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return Object.assign(state, {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

function answer(summary: string, picks: number[]): string {
  return JSON.stringify({ summary, items: picks.map(label) });
}

function testContext(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

before(async () => {
  plex = await startMockPlex({ sections: [{ key: "1", title: "Films", type: "movie" }], items: ITEMS });
  llm = await startMockLlm();
});

after(async () => {
  await plex?.close();
  await llm?.close();
});

beforeEach(() => {
  plex.collections.clear();
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  llm.calls.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("global_llm", { provider: "openai-compatible", model: "test-model", baseUrl: `${llm.origin}/v1` });
  deleteConfig("ai_monthly_token_budget");
  db.delete(llmUsage).run();
  db.delete(plexUsers).run();
  db.delete(playbackSessions).run();

  const now = Date.now();
  db.insert(plexUsers)
    .values([
      { userId: 10, username: "alice", label: "alice", syncedAt: now },
      { userId: 11, username: "bob", label: "bob", syncedAt: now },
    ])
    .run();
  // Alice has watched films 0–5; Bob nothing, so he is skipped.
  for (let i = 0; i <= 5; i++) {
    db.insert(playbackSessions)
      .values({
        id: `p${i}`,
        userId: 10,
        username: "alice",
        ratingKey: String(100 + i),
        title: `Film ${i}`,
        type: "movie",
        startedAt: now - i * 86_400_000,
        lastSeenAt: now,
        completionPct: 1,
      })
      .run();
  }
});

describe("we-think-youd-like", () => {
  it("builds one row for each person with history, leaving out what they've seen", async () => {
    llm.answer = answer("Quiet dramas with a long fuse.", [0, 1, 10, 11, 12, 13, 14, 15, 16]);
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);

    assert.equal(llm.calls.length, 1, "one call: Bob has no history");
    assert.match(log.join("\n"), /bob: 0 title\(s\)/);
    assert.equal(plex.collections.size, 1);
    const [row] = [...plex.collections.values()];
    assert.equal(row.title, "We Think You'd Like");
    assert.deepEqual(row.labels, ["Tinkerbell", WTYL_LABEL, "User:alice"]);
    assert.equal(row.summary, "Quiet dramas with a long fuse.");
    // Films 0 and 1 are Alice's own; the rest in order, cut to maxItems.
    assert.deepEqual(row.memberKeys, ["110", "111", "112", "113", "114", "115"]);
    assert.deepEqual(plex.journal.pinned, [row.ratingKey]);

    // The library is the cached prefix, and her history is in the prompt.
    const body = JSON.parse(llm.calls[0]);
    const sent = JSON.stringify(body.messages);
    assert.match(sent, /<library>/);
    assert.match(sent, /<history>/);
  });

  it("edits the row in place on the next run rather than replacing it", async () => {
    llm.answer = answer("First take.", [10, 11, 12, 13, 14, 15]);
    await run(testContext().ctx, CONFIG);
    const [first] = [...plex.collections.values()];

    llm.answer = answer("Second take.", [12, 13, 14, 15, 16, 17]);
    await run(testContext().ctx, CONFIG);

    assert.equal(plex.collections.size, 1);
    const [second] = [...plex.collections.values()];
    assert.equal(second.ratingKey, first.ratingKey);
    assert.deepEqual(plex.journal.deletedCollections, []);
    assert.deepEqual([...second.memberKeys].sort(), ["112", "113", "114", "115", "116", "117"]);
    assert.equal(second.summary, "Second take.");
    assert.deepEqual(plex.journal.pinned, [first.ratingKey], "pinned once, on creation");
  });

  it("leaves last week's row alone when an answer has too few usable picks", async () => {
    llm.answer = answer("Good week.", [10, 11, 12, 13, 14, 15]);
    await run(testContext().ctx, CONFIG);
    const before = structuredClone([...plex.collections.values()][0]);

    llm.answer = answer("Bad week.", [0, 1, 2, 10, 99]);
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);

    const after = [...plex.collections.values()][0];
    assert.deepEqual(after.memberKeys, before.memberKeys);
    assert.equal(after.summary, "Good week.");
    assert.match(log.join("\n"), /only 1 usable pick\(s\), need 5; row left as it is/);
  });

  it("makes no call and writes nothing once the token budget is spent", async () => {
    services.aiUsage.record({
      feature: "rule",
      provider: "openai-compatible",
      model: "test-model",
      tokensIn: 600,
      tokensOut: 400,
      ok: true,
      durationMs: 1,
    });
    setConfig("ai_monthly_token_budget", 1_000);
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);
    assert.equal(llm.calls.length, 0);
    assert.equal(plex.journal.createdCollections.length, 0);
    assert.match(log.join("\n"), /Skipping/);
  });

  it("is torn down without touching Because You Watched's rows", async () => {
    llm.answer = answer("Mine.", [10, 11, 12, 13, 14, 15]);
    await run(testContext().ctx, CONFIG);
    plex.collections.set("8000", {
      ratingKey: "8000",
      title: "Because you watched Film 0",
      sectionId: "1",
      labels: ["Tinkerbell", "BecauseYouWatched", "User:alice"],
      memberKeys: ["110"],
    });

    await remove(testContext().ctx);

    assert.deepEqual([...plex.collections.keys()], ["8000"]);
  });
});
