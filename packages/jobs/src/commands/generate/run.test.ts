/**
 * The batch loop's failure handling: one broken rule out of many must not
 * abandon the rules after it, and an AI rule with no usable LLM must be
 * skipped rather than run (and rather than have its existing collections
 * deleted and replaced with nothing).
 *
 * Plex is served by a stubbed `fetch` — the loop only needs identity,
 * sections, and an empty collection list per section to get as far as the
 * per-rule handlers, which is where the interesting behaviour lives.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "../../test-support/temp-db.ts";
import type { JobContext } from "@tinkerbell/core";

setupTempDb();

const { db, rules, config } = await import("@tinkerbell/db");
const { setConfig, noopCheckpoint } = await import("@tinkerbell/core");
const { llmUnavailableReason } = await import("./ai/llm.ts");
const run = (await import("./index.ts")).default;

const SECTIONS = [
  { key: "1", title: "Films", type: "movie" },
  { key: "2", title: "Shows", type: "show" },
];

const realFetch = globalThis.fetch;

/**
 * Minimal Plex server. Every library-content request comes back empty, so
 * nothing is deleted and nothing is created — the rules under test either
 * skip, throw in their handler, or no-op.
 */
function stubPlex(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

    if (url.pathname === "/") return json({ MediaContainer: { friendlyName: "Test", machineIdentifier: "machine-1" } });
    if (url.pathname === "/library/sections") return json({ MediaContainer: { Directory: SECTIONS } });
    if (url.pathname.startsWith("/library/sections/")) return json({ MediaContainer: { Metadata: [] } });
    throw new Error(`unexpected Plex request: ${url.pathname}`);
  }) as typeof fetch;
}

/**
 * Rules are ordered by `createdAt`, and the point of these tests is what
 * happens to the rules *after* a failure — so the timestamps are set
 * explicitly rather than left to collide within the same millisecond.
 */
function seedRule(name: string, type: string, ruleConfig: Record<string, unknown>, createdAt: number): string {
  const id = `rule-${createdAt}`;
  db.insert(rules).values({ id, name, type, config: ruleConfig, enabled: 1, createdAt }).run();
  return id;
}

function ruleRow(id: string): { lastRunStatus: string | null; lastRunError: string | null } {
  const row = db.select().from(rules).where(eqRule(id)).get();
  return { lastRunStatus: row?.lastRunStatus ?? null, lastRunError: row?.lastRunError ?? null };
}

const { eq } = await import("drizzle-orm");
const eqRule = (id: string) => eq(rules.id, id);

/** A context that records its log so assertions can read what the job said. */
function testContext(signal?: AbortSignal): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: signal ?? new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

beforeEach(() => {
  db.delete(rules).run();
  db.delete(config).run();
  setConfig("global_plex_url", "http://plex.test:32400");
  setConfig("global_plex_token", "token");
  stubPlex();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("llmUnavailableReason", () => {
  it("reports an unconfigured provider", () => {
    const reason = llmUnavailableReason();
    assert.match(reason ?? "", /no LLM provider is configured/i);
  });

  it("reports a provider configured without its API key", () => {
    // The shape that motivated this: a provider saved in Settings, key blank.
    setConfig("global_llm", { provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
    assert.match(llmUnavailableReason() ?? "", /API key/i);
  });

  it("returns null when the provider is usable", () => {
    setConfig("global_llm", { provider: "anthropic", model: "claude-sonnet-4-5-20250929", apiKey: "sk-test" });
    assert.equal(llmUnavailableReason(), null);
  });
});

describe("generate: one bad rule", () => {
  it("skips AI rules when no LLM is configured and keeps going", async () => {
    const ai = seedRule("AI Collections", "ai_prompt", { prompt: "be creative" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    const { ctx, log } = testContext();
    await run(ctx, {});

    const text = log.join("\n");
    assert.match(text, /Skipping AI rule/);
    // Not run, so its last-run record is left exactly as it was.
    assert.equal(ruleRow(ai).lastRunStatus, null);
    // The rule after it still ran.
    assert.equal(ruleRow(after).lastRunStatus, "ok");
  });

  it("records a failing rule and still runs the rest", async () => {
    // Trakt is a recognised provider the handler explicitly rejects — a
    // deterministic handler-level failure that needs no network.
    const broken = seedRule("Broken list", "list_source", { listProvider: "trakt", listId: "abc" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.equal(ruleRow(broken).lastRunStatus, "error");
    assert.match(ruleRow(broken).lastRunError ?? "", /Trakt/i);
    assert.equal(ruleRow(after).lastRunStatus, "ok");

    const text = log.join("\n");
    assert.match(text, /1 of 2 rule\(s\) failed/);
    assert.match(text, /All done!/);
  });

  it("still propagates a failure once the job itself has been cancelled", async () => {
    const broken = seedRule("Broken list", "list_source", { listProvider: "trakt", listId: "abc" }, 1);
    const after = seedRule("Later", "no_such_type", {}, 2);

    // Cancel the job at the moment the doomed rule starts fetching, so the
    // rule's failure and an aborted signal arrive together — the case where
    // "keep going" would be wrong.
    const controller = new AbortController();
    const { ctx } = testContext(controller.signal);
    const log = ctx.log;
    ctx.log = (...args: unknown[]) => {
      log(...args);
      if (args.map(String).join(" ").includes("Fetching trakt")) controller.abort();
    };

    await assert.rejects(run(ctx, {}), /Trakt/i);
    assert.equal(ruleRow(broken).lastRunStatus, "error");
    // Cancellation means the rules after it are not attempted.
    assert.equal(ruleRow(after).lastRunStatus, null);
  });
});
