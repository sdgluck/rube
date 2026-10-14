/**
 * We Think You'd Like and Because You Watched with the built-in recommender
 * on, end to end through a mock Plex and a mock OpenAI-compatible provider.
 *
 * The model is `__fixtures__/films.bin`, written by `ml/` (`uv run recs
 * fixture`): twenty films in two clusters, 0–9 and 10–19. Alice has watched
 * 0–5, so everything below can be checked against "6–9 first".
 *
 * Three things are protected, for each feature:
 *  - with no AI provider at all, the recommender alone still builds the row,
 *    and nothing is sent anywhere;
 *  - with one, the model is sent the recommender's shortlist, not the library;
 *  - where too little of the library has vectors, the old whole-library path
 *    runs exactly as before.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { noopCheckpoint, ConfigStoreToken, type JobContext } from "@tinkerbell/core";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, llmUsage, mediaItems, playbackSessions, plexUsers } from "@tinkerbell/db";
import { createRecommendations, RecommendationsToken } from "@tinkerbell/domain.recommendations";
import { startMockPlex, type MockPlex } from "../test-support/mock-plex-server.ts";
import { createWeThinkYoudLikeCommand } from "./we-think-youd-like/index.ts";
import { createBecauseYouWatchedCommand } from "./because-you-watched.ts";

const c = createTestContainer({
  overrides: (r) =>
    r.replace(RecommendationsToken, (ctx) =>
      createRecommendations({
        db: ctx.resolve(DbToken),
        config: ctx.resolve(ConfigStoreToken),
        modelPath: join(import.meta.dirname, "__fixtures__", "films.bin"),
      }),
    ),
});
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { deleteConfig, setConfig } = c.resolve(ConfigStoreToken);
const wtyl = createWeThinkYoudLikeCommand(services);
const byw = createBecauseYouWatchedCommand(services);

const ITEMS = Array.from({ length: 20 }, (_, i) => ({
  ratingKey: String(100 + i),
  title: `Film ${i}`,
  year: 2000 + i,
  sectionId: "1",
  guids: [],
  labels: [],
}));
const label = (i: number) => `Film ${i} (${2000 + i})`;
const key = (i: number) => String(100 + i);
const CLUSTER_A = new Set([6, 7, 8, 9].map(key));

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

/** The fenced library a model call was sent, one title per line. */
function libraryOf(call: string): string[] {
  const sent = JSON.stringify(JSON.parse(call).messages);
  const block = /<library>(.*?)<\/library>/.exec(sent)?.[1] ?? "";
  return block
    .split("\\n")
    .map((l) => l.trim())
    .filter(Boolean);
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

/** Every film in the index, each with the TMDb id the fixture keys it by — or, for `uncovered`, none. */
function indexLibrary(uncovered: number[] = []) {
  db.delete(mediaItems).run();
  db.insert(mediaItems)
    .values(
      ITEMS.map((item, i) => ({
        ratingKey: item.ratingKey,
        sectionId: "1",
        sectionTitle: "Films",
        title: item.title,
        year: item.year,
        type: "movie",
        tmdbId: uncovered.includes(i) ? null : 1000 + i,
        syncedAt: 0,
      })),
    )
    .run();
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
  plex.history.length = 0;
  for (const list of Object.values(plex.journal)) if (Array.isArray(list)) list.length = 0;
  llm.calls.length = 0;
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "test-token");
  setConfig("global_llm", { provider: "openai-compatible", model: "test-model", baseUrl: `${llm.origin}/v1` });
  setConfig("recommender_enabled", true);
  deleteConfig("ai_monthly_token_budget");
  db.delete(llmUsage).run();
  db.delete(plexUsers).run();
  db.delete(playbackSessions).run();
  indexLibrary();

  const now = Date.now();
  db.insert(plexUsers)
    .values([{ userId: 10, username: "alice", label: "alice", syncedAt: now }])
    .run();
  for (let i = 0; i <= 5; i++) {
    db.insert(playbackSessions)
      .values({
        id: `p${i}`,
        userId: 10,
        username: "alice",
        ratingKey: key(i),
        title: `Film ${i}`,
        type: "movie",
        startedAt: now - i * 86_400_000,
        lastSeenAt: now,
        completionPct: 1,
      })
      .run();
  }
  // What Because You Watched reads: Plex's own history, newest first.
  plex.history.push({ ratingKey: key(3), title: "Film 3", year: 2003, type: "movie", librarySectionID: "1" });
});

describe("we-think-youd-like with the recommender", () => {
  const CONFIG = { minItems: 5, maxItems: 6, minLibrarySize: 1 };

  it("builds the row from the recommender alone when there is no AI provider", async () => {
    deleteConfig("global_llm");
    const { ctx, log } = testContext();
    await wtyl.run(ctx, CONFIG);

    assert.equal(llm.calls.length, 0, "nothing is sent anywhere");
    assert.equal(plex.collections.size, 1, log.join("\n"));
    const [row] = [...plex.collections.values()];
    assert.equal(row.memberKeys.length, 6);
    assert.deepEqual(new Set(row.memberKeys.slice(0, 4)), CLUSTER_A, "the rest of her cluster first");
    for (let i = 0; i <= 5; i++) assert.ok(!row.memberKeys.includes(key(i)), `film ${i} is hers already`);
    assert.match(row.summary ?? "", /^Picked from what you've been watching/);
  });

  it("sends the model the shortlist, not the library", async () => {
    llm.answer = JSON.stringify({ summary: "More of the same.", items: [6, 7, 8, 9, 10, 11].map(label) });
    await wtyl.run(testContext().ctx, CONFIG);

    assert.equal(llm.calls.length, 1);
    const library = libraryOf(llm.calls[0]);
    assert.equal(library.length, 14, "the twenty films less the six she's seen");
    assert.ok(!library.some((l) => l.startsWith("Film 0 ")), "nothing she's seen");
    assert.match(JSON.stringify(JSON.parse(llm.calls[0]).messages), /best fit this viewer's history/);
    const [row] = [...plex.collections.values()];
    assert.equal(row.summary, "More of the same.");
  });

  it("runs the old whole-library path when too little of the library has vectors", async () => {
    indexLibrary(Array.from({ length: 14 }, (_, i) => i + 6));
    llm.answer = JSON.stringify({ summary: "Whole library.", items: [6, 7, 8, 9, 10, 11].map(label) });
    await wtyl.run(testContext().ctx, CONFIG);

    const library = libraryOf(llm.calls[0]);
    assert.equal(library.length, 20, "every title, as before the recommender");
    assert.doesNotMatch(JSON.stringify(JSON.parse(llm.calls[0]).messages), /best fit this viewer's history/);
  });

  it("leaves the row alone when it can't rank the library and there is no AI", async () => {
    deleteConfig("global_llm");
    indexLibrary(Array.from({ length: 14 }, (_, i) => i + 6));
    const { ctx, log } = testContext();
    await wtyl.run(ctx, CONFIG);
    assert.equal(plex.collections.size, 0);
    assert.match(log.join("\n"), /couldn't rank enough of this library/);
  });

  it("still refuses to run with neither an AI provider nor the recommender", async () => {
    deleteConfig("global_llm");
    setConfig("recommender_enabled", false);
    await assert.rejects(wtyl.run(testContext().ctx, CONFIG), /turn on the built-in recommender/);
  });
});

describe("because-you-watched with the recommender", () => {
  const CONFIG = { mode: "server" as const, limit: 1, minItems: 5, maxItems: 6, minLibrarySize: 1 };

  it("builds the row from the recommender alone when there is no AI provider", async () => {
    deleteConfig("global_llm");
    const { ctx, log } = testContext();
    await byw.run(ctx, CONFIG);

    assert.equal(llm.calls.length, 0);
    assert.equal(plex.collections.size, 1, log.join("\n"));
    const [row] = [...plex.collections.values()];
    assert.equal(row.title, "Because you watched Film 3 (2003)");
    assert.equal(row.memberKeys.length, 6);
    assert.ok(!row.memberKeys.includes(key(3)), "never the film it is named for");
    for (const k of row.memberKeys) assert.ok(Number(k) < 110, `${k} is from the other cluster`);
  });

  it("sends the model the closest titles, its own cluster first", async () => {
    llm.answer = JSON.stringify({
      name: "Because you watched Film 3 (2003)",
      items: [2, 4, 1, 5, 0, 6].map(label),
    });
    await byw.run(testContext().ctx, CONFIG);

    assert.equal(llm.calls.length, 1);
    const library = libraryOf(llm.calls[0]);
    assert.equal(library.length, 19, "everything but the watched film");
    assert.ok(
      library.slice(0, 9).every((l) => Number(/Film (\d+)/.exec(l)![1]) < 10),
      "its own cluster ahead of the other",
    );
    assert.match(JSON.stringify(JSON.parse(llm.calls[0]).messages), /most like the one they watched/);
  });
});
