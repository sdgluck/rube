/**
 * The section-type gate in `handlerForRule`.
 *
 * A rule aimed at a library its source has no data for used to run and
 * "succeed" with nothing: Rotten Tomatoes on TV built one collection of one
 * show, streaming on films built none. The gate sits in dispatch so every
 * ending (collection, playlist, cleanup, metadata, preview) skips the same
 * way, and the skip is said out loud in the run log.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@rube/core";
import type { PlexClient, PlexSection } from "@rube/plex";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { createDispatchCommand } from "./dispatch.ts";
import type { HandlerDeps } from "./types.ts";

const c = createTestContainer();
after(() => c.dispose());
const { handlerForRule } = createDispatchCommand(c.resolve(ServicesToken));

const SECTIONS = [
  { key: "1", title: "Films", type: "movie" },
  { key: "2", title: "TV", type: "show" },
] as PlexSection[];

async function scannedSections(ruleType: string) {
  const scanned: string[] = [];
  const log: string[] = [];
  const client = {
    allItems(sectionKey: string) {
      scanned.push(sectionKey);
      return (async function* () {})();
    },
  } as unknown as PlexClient;
  const ctx = { log: (m: string) => log.push(m) } as unknown as JobContext;
  const handler = handlerForRule(ruleType);
  assert.ok(handler);
  const deps = { ctx, client, sections: SECTIONS, ruleConfig: {} } as unknown as HandlerDeps;
  for await (const _ of handler(deps)) {
    // nothing to build from an empty library
  }
  return { scanned, log };
}

test("a films-only rule never scans the TV section, and says so", async () => {
  const { scanned, log } = await scannedSections("resolutions");
  assert.deepEqual(scanned, ["1"]);
  assert.ok(log.some((m) => m.includes('Skipping "TV"') && m.includes("movie libraries")));
});

test("a rule that works for both kinds scans both", async () => {
  const { scanned, log } = await scannedSections("decades");
  assert.deepEqual(scanned, ["1", "2"]);
  assert.ok(!log.some((m) => m.startsWith("Skipping")));
});
