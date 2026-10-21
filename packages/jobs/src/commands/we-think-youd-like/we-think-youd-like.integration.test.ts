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
import { displayTitle, noopCheckpoint, personalRowTitle, ConfigStoreToken, type JobContext } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, llmUsage, playbackSessions, plexUsers } from "@rube/db";
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
let llm: {
  origin: string;
  calls: string[];
  answer: string;
  onCall?: () => void;
  close: () => Promise<void>;
};

async function startMockLlm(): Promise<typeof llm> {
  const state: { calls: string[]; answer: string; onCall?: () => void } = { calls: [], answer: "" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      state.calls.push(body);
      state.onCall?.();
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
  llm.onCall = undefined;
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
    assert.equal(displayTitle(row.title), "We Think You'd Like");
    assert.equal(
      row.title,
      personalRowTitle("We Think You'd Like", "alice"),
      "her own title, so her row's contents are hers",
    );
    // No baseline label: restrictions are `label=Rube,User:<self>`, an OR, so
    // carrying it would show Alice's row to everyone.
    assert.deepEqual(row.labels, [WTYL_LABEL, "User:alice"]);
    assert.equal(row.summary, "Quiet dramas with a long fuse.");
    // Films 0 and 1 are Alice's own; the rest in order, cut to maxItems.
    assert.deepEqual(row.memberKeys, ["110", "111", "112", "113", "114", "115"]);
    assert.deepEqual(plex.journal.pinned, [row.ratingKey]);
    assert.deepEqual(
      plex.journal.pinHomes,
      [{ ratingKey: row.ratingKey, own: false, shared: true, recommended: false }],
      "on Alice's Home, and off the owner's Recommended tab",
    );

    // The library is the cached prefix, and her history is in the prompt.
    const body = JSON.parse(llm.calls[0]);
    const sent = JSON.stringify(body.messages);
    assert.match(sent, /<library>/);
    assert.match(sent, /<history>/);
  });

  it("keeps each person's picks in their own row", async () => {
    // Plex keeps collection membership by title (the mock models it): with one
    // shared title, Alice's and Bob's rows were one pooled list of both.
    db.insert(playbackSessions)
      .values(
        [10, 11, 12, 13, 14].map((i) => ({
          id: `b${i}`,
          userId: 11,
          username: "bob",
          ratingKey: String(100 + i),
          title: `Film ${i}`,
          type: "movie",
          startedAt: Date.now() - (i - 9) * 86_400_000,
          lastSeenAt: Date.now(),
          completionPct: 1,
        })),
      )
      .run();
    let call = 0;
    llm.onCall = () => {
      // Alice first (her history is 0–5), then Bob (10–14): different picks.
      llm.answer = call++ === 0 ? answer("Alice's.", [6, 7, 8, 9, 15, 16]) : answer("Bob's.", [0, 1, 2, 3, 4, 5]);
    };
    await run(testContext().ctx, CONFIG);

    const rows = [...plex.collections.values()];
    assert.equal(rows.length, 2);
    const alice = rows.find((r) => r.labels.includes("User:alice"))!;
    const bob = rows.find((r) => r.labels.includes("User:bob"))!;
    assert.notEqual(alice.title, bob.title);
    assert.equal(displayTitle(alice.title), displayTitle(bob.title), "and they read the same");
    assert.deepEqual([...alice.memberKeys].sort(), ["106", "107", "108", "109", "115", "116"]);
    assert.deepEqual([...bob.memberKeys].sort(), ["100", "101", "102", "103", "104", "105"]);
  });

  it("replaces a row made under the shared title, once, with one under the person's own", async () => {
    plex.collections.set("9100", {
      ratingKey: "9100",
      title: "We Think You'd Like",
      sectionId: "1",
      labels: [WTYL_LABEL, "User:alice"],
      memberKeys: ["110", "111"],
    });
    llm.answer = answer("Fresh.", [10, 11, 12, 13, 14, 15]);
    await run(testContext().ctx, CONFIG);

    assert.deepEqual(plex.journal.deletedCollections, ["9100"]);
    const [row] = [...plex.collections.values()];
    assert.equal(row.title, personalRowTitle("We Think You'd Like", "alice"));

    // And on the run after, it is the row that is kept and edited.
    llm.answer = answer("Again.", [12, 13, 14, 15, 16, 17]);
    await run(testContext().ctx, CONFIG);
    assert.deepEqual(plex.journal.deletedCollections, ["9100"], "not rebuilt a second time");
    assert.equal([...plex.collections.values()][0].ratingKey, row.ratingKey);
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

  it("pins the owner's row to their own Home, not every shared user's", async () => {
    db.update(plexUsers).set({ isOwner: 1 }).run();
    llm.answer = answer("Mine.", [10, 11, 12, 13, 14, 15]);
    await run(testContext().ctx, CONFIG);
    const [row] = [...plex.collections.values()];
    assert.deepEqual(plex.journal.pinHomes, [
      { ratingKey: row.ratingKey, own: true, shared: false, recommended: true },
    ]);
  });

  it("repairs a row made with the baseline label for someone with too little history to rebuild it", async () => {
    plex.collections.set("9001", {
      ratingKey: "9001",
      title: "We Think You'd Like",
      sectionId: "1",
      labels: ["Rube", WTYL_LABEL, "User:bob"],
      memberKeys: ["110"],
    });
    await run(testContext().ctx, CONFIG);
    assert.deepEqual(plex.collections.get("9001")?.labels, [WTYL_LABEL, "User:bob"]);
  });

  it("repairs a row made with the baseline label, even when the answer is unusable", async () => {
    plex.collections.set("9000", {
      ratingKey: "9000",
      title: "We Think You'd Like",
      sectionId: "1",
      labels: ["Rube", WTYL_LABEL, "User:alice"],
      memberKeys: ["110"],
    });
    llm.answer = "not json";
    const { ctx, log } = testContext();
    await run(ctx, CONFIG);

    assert.deepEqual(plex.collections.get("9000")?.labels, [WTYL_LABEL, "User:alice"]);
    assert.deepEqual(plex.journal.pinHomes, [{ ratingKey: "9000", own: false, shared: true, recommended: false }]);
    assert.match(log.join("\n"), /visible to alice only/);

    // Once: a second run leaves the pin where Alice has since put it.
    await run(testContext().ctx, CONFIG);
    assert.equal(plex.journal.pinHomes.length, 1);
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

  it("stops when cancelled, rather than failing every call after and claiming to be done", async () => {
    db.insert(playbackSessions)
      .values(
        [0, 1, 2, 3, 4, 5].map((i) => ({
          id: `b${i}`,
          userId: 11,
          username: "bob",
          ratingKey: String(100 + i),
          title: `Film ${i}`,
          type: "movie",
          startedAt: Date.now() - i * 86_400_000,
          lastSeenAt: Date.now(),
          completionPct: 1,
        })),
      )
      .run();
    const controller = new AbortController();
    const { ctx, log } = testContext();
    llm.answer = answer("Mine.", [10, 11, 12, 13, 14, 15]);
    llm.onCall = () => controller.abort();
    await assert.rejects(() => run({ ...ctx, signal: controller.signal }, CONFIG));
    assert.equal(llm.calls.length, 1, "Bob's call was never made");
    assert.doesNotMatch(log.join("\n"), /All done!/);
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
      labels: ["Rube", "BecauseYouWatched", "User:alice"],
      memberKeys: ["110"],
    });

    await remove(testContext().ctx);

    assert.deepEqual([...plex.collections.keys()], ["8000"]);
  });
});
