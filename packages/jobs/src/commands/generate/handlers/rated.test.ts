/**
 * The limit is the whole promise of a Top Rated rule. Plex once answered its
 * paged request with an entire 4,273-film section, and the rule built a
 * collection of all of it — so the handler holds the line itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@rube/core";
import type { PlexClient, PlexSection } from "@rube/plex";
import { ratedHandler } from "./rated.ts";
import type { HandlerDeps, PendingCollection } from "../types.ts";

async function run(limit: number | undefined, served: number) {
  const client = {
    fetchItemsSorted: async () =>
      Array.from({ length: served }, (_, i) => ({ ratingKey: String(i), title: `Film ${i}` })),
  } as unknown as PlexClient;
  const deps = {
    ctx: { log() {} } as unknown as JobContext,
    client,
    sections: [{ key: "1", title: "Films", type: "movie" }] as PlexSection[],
    ruleConfig: { limit },
  } as unknown as HandlerDeps;
  const out: PendingCollection[] = [];
  for await (const pending of ratedHandler("top")(deps)) out.push(pending);
  return out;
}

test("a server that ignores the page size still yields only the rule's limit", async () => {
  const [pending] = await run(50, 4273);
  assert.equal(pending.matched.length, 50);
});

test("with no limit set, the default of 50 holds", async () => {
  const [pending] = await run(undefined, 4273);
  assert.equal(pending.matched.length, 50);
});
