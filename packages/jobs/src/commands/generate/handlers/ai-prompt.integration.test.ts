/**
 * The ai_prompt handler's recommender mode end to end: a real LLM client over
 * HTTP against a scripted provider, the real recommender reading the tiny
 * fixture model, and the real rule-history and config stores.
 *
 * What's protected is the top-up loop — when too few of the model's themes
 * survive the example checks, the handler asks again for the shortfall, tells
 * the model what is taken, and stops after `MAX_TOP_UPS` — because a regression
 * there is either silent (a rule quietly makes two collections instead of ten)
 * or expensive (a loop that keeps calling a provider).
 */
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createServer } from "node:http";
import { noopCheckpoint } from "@rube/core";
import { ConfigStoreToken } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, mediaItems } from "@rube/db";
import { createRecommendations, RecommendationsToken } from "@rube/domain.recommendations";
import type { PlexClient } from "@rube/plex";
import type { Rule } from "@rube/domain.rules";
import type { RuleConfig } from "../config.ts";
import { createAiPromptCommand } from "./ai-prompt.ts";

const FIXTURE = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "domains",
  "recommendations",
  "src",
  "__fixtures__",
  "tiny.bin",
);

const c = createTestContainer({
  overrides: (r) =>
    r.replace(RecommendationsToken, (c) =>
      createRecommendations({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken), modelPath: FIXTURE }),
    ),
});
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { aiPromptHandler } = createAiPromptCommand(c.resolve(ServicesToken));

/** "Film n" is movie:n in the fixture; "Show 10" is tv:10; the rest have no vector. */
const LIBRARY = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ ratingKey: `m${n}`, title: `Film ${n}`, type: "movie", tmdbId: n })),
  { ratingKey: "s10", title: "Show 10", type: "show", tmdbId: 10 },
  ...["w", "x", "y", "z"].map((k) => ({ ratingKey: k, title: `Unknown ${k}`, type: "movie", tmdbId: null })),
];
db.insert(mediaItems)
  .values(LIBRARY.map((i) => ({ ...i, sectionId: "1", sectionTitle: "Films", syncedAt: 0 })))
  .run();
setConfig("recommender_enabled", true);

const client = { fetchAllItems: async () => LIBRARY.map(({ ratingKey, title }) => ({ ratingKey, title })) };

/**
 * An OpenAI-compatible provider answering each theme call with the next
 * scripted reply (the last repeats), and the naming call with `names`.
 */
async function scriptedLlm(replies: unknown[], names: unknown = []) {
  const prompts: string[] = [];
  let themeCalls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { messages: Array<{ content: string }> };
      const prompt = parsed.messages.map((m) => m.content).join("\n");
      prompts.push(prompt);
      const reply = prompt.startsWith("You are naming") ? names : replies[Math.min(++themeCalls, replies.length) - 1];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: JSON.stringify(reply) } }],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  setConfig("global_llm", {
    provider: "openai-compatible",
    model: "test-model",
    baseUrl: `http://127.0.0.1:${port}/v1`,
  });
  return { prompts, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function run(config: Partial<RuleConfig>) {
  const log: string[] = [];
  const names: string[] = [];
  const handler = aiPromptHandler({
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
    client: client as unknown as PlexClient,
    sections: [{ key: "1", title: "Films", type: "movie" }] as never,
    rule: { id: "ai-rule" } as Rule,
    ruleConfig: { themes: ["Anything"], limit: 2, minItems: 2, maxItems: 3, aiFill: "recommender", ...config },
  });
  for await (const pending of handler) names.push(pending.name);
  return { log, names };
}

const theme = (name: string, ...items: string[]) => ({ name, items });

describe("ai_prompt, filled by the recommender", () => {
  beforeEach(() => setConfig("recommender_enabled", true));

  it("asks again for the themes that didn't survive, naming what's taken", async () => {
    const llm = await scriptedLlm([
      // The copy reuses both examples, so only one theme survives the first call.
      [theme("First", "Film 1", "Film 2"), theme("Copy", "Film 1", "Film 2")],
      // "Unknown x" has no vector, so cohesion can't object to the pair.
      [theme("Second", "Film 4", "Unknown x")],
    ]);
    try {
      const { names, log } = await run({});
      assert.deepEqual(names, ["First", "Second"]);
      // Two for themes, one to name them.
      assert.equal(llm.prompts.length, 3);
      assert.match(llm.prompts[1]!, /already taken — do NOT use any of them: Film 1; Film 2/);
      assert.match(llm.prompts[1]!, /Create exactly 1 collections/);
      assert.ok(log.some((l) => l.includes(`"Copy": skipped — 0 usable example(s) (2 already used`)));
    } finally {
      await llm.close();
    }
  });

  it("stops after two extra calls, keeping what it has", async () => {
    const llm = await scriptedLlm([[theme("First", "Film 1", "Film 2")], [theme("Again", "Film 1", "Film 2")]]);
    try {
      const { names } = await run({});
      assert.deepEqual(names, ["First"]);
      assert.equal(llm.prompts.length, 4);
    } finally {
      await llm.close();
    }
  });

  it("renames each collection from its titles, keeping a name the model fumbled", async () => {
    const llm = await scriptedLlm(
      [[theme("Seeded", "Film 1", "Film 2"), theme("Other", "Film 4", "Unknown x")]],
      [{ index: 1, name: "Named From Titles" }],
    );
    try {
      const { names, log } = await run({});
      assert.deepEqual(names, ["Named From Titles", "Other"]);
      const naming = llm.prompts.at(-1)!;
      assert.match(naming, /1\. "Seeded": Film 1; Film 2/);
      assert.ok(log.includes(`Renamed "Seeded" → "Named From Titles" from its titles.`));
    } finally {
      await llm.close();
    }
  });

  it("doesn't top up when the AI picks every title", async () => {
    const llm = await scriptedLlm([[theme("Only", "Film 1", "Film 2", "Film 3")]]);
    try {
      const { names } = await run({ aiFill: "llm" });
      assert.deepEqual(names, ["Only"]);
      assert.equal(llm.prompts.length, 1);
    } finally {
      await llm.close();
    }
  });
});
