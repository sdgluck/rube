/**
 * Labelling new arrivals for personalization, through the two real jobs that
 * do it (`sync-recently-added` every 15 minutes, `sync-media` nightly) against
 * the mock Plex.
 *
 * With personalization on, a shared user sees only `label=Rube` items, and
 * nothing labelled anything added after the enable job ran, so a new show was
 * invisible to every shared user until someone pressed Reconcile.
 */
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { ConfigStoreToken, noopCheckpoint, type JobContext } from "@rube/core";
import { startMockPlex, type MockPlex } from "@rube/test-support";

import { createSyncMediaCommand } from "../commands/sync-media.ts";
import { createInternalJobs } from "../internal-jobs.ts";

const c = createTestContainer();
after(() => c.dispose());

const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createSyncMediaCommand(c.resolve(ServicesToken));
const recentlyAdded = createInternalJobs(c.resolve(ServicesToken)).internalJobs["sync-recently-added"];

const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

let plex: MockPlex;
beforeEach(async () => {
  await plex?.close();
  plex = await startMockPlex({
    sections: SECTIONS,
    items: [
      { ratingKey: "1", title: "Labelled Earlier", sectionId: "1", guids: [], labels: ["Rube"] },
      { ratingKey: "2", title: "New Arrival", sectionId: "1", guids: [], labels: ["Disney+ Movies"] },
    ],
  });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "t");
});
after(() => plex.close());

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

describe("sync-media personalization labels", () => {
  it("labels only the items missing the baseline label while personalization is enabled", async () => {
    setConfig("global_personalized_sharing", { status: "enabled" });
    const { ctx, log } = testContext();
    await run(ctx, {});

    assert.deepEqual(plex.items.get("2")!.labels, ["Disney+ Movies", "Rube"]);
    assert.deepEqual(
      plex.journal.labelWriteRequests.map((r) => r.ids),
      [["2"]],
    );
    assert.ok(log.includes('Personalization labels: 1 new item(s) labelled "Rube" so shared users can see them'));
  });

  it("says so when everything is already labelled", async () => {
    // A real run that found nothing to do printed nothing, which read exactly
    // like a build without the labelling at all.
    setConfig("global_personalized_sharing", { status: "enabled" });
    await run(testContext().ctx, {});
    plex.journal.labelWriteRequests.length = 0;

    const { ctx, log } = testContext();
    await run(ctx, {});
    assert.deepEqual(plex.journal.labelWriteRequests, []);
    assert.ok(log.includes("Personalization labels: all items already labelled"));
  });

  for (const status of ["disabled", "enabling", "disabling"] as const) {
    it(`labels nothing while personalization is ${status}, and says why`, async () => {
      setConfig("global_personalized_sharing", { status });
      const { ctx, log } = testContext();
      await run(ctx, {});
      assert.deepEqual(plex.journal.labelWriteRequests, []);
      assert.ok(log.includes(`Personalization labels: skipped (personalization is ${status})`));
    });
  }
});

describe("sync-recently-added personalization labels", () => {
  it("labels new arrivals on the 15-minute tick and puts it in the summary", async () => {
    setConfig("global_personalized_sharing", { status: "enabled" });
    const summary = await recentlyAdded.run(testContext().ctx);

    assert.deepEqual(
      plex.journal.labelWriteRequests.map((r) => r.ids),
      [["2"]],
    );
    assert.match(summary, /Personalization labels: 1 new item\(s\) labelled/);
  });

  it("keeps the summary quiet when there is nothing to label", async () => {
    setConfig("global_personalized_sharing", { status: "enabled" });
    await recentlyAdded.run(testContext().ctx);
    const summary = await recentlyAdded.run(testContext().ctx);
    assert.doesNotMatch(summary, /Personalization/);
  });

  it("labels nothing while personalization is disabled", async () => {
    setConfig("global_personalized_sharing", { status: "disabled" });
    await recentlyAdded.run(testContext().ctx);
    assert.deepEqual(plex.journal.labelWriteRequests, []);
  });
});
