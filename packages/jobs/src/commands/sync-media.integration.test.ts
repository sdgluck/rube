/**
 * `sync-media` labelling new arrivals for personalization, through the real
 * job against the mock Plex.
 *
 * With personalization on, a shared user sees only `label=Tinkerbell` items, and
 * nothing labelled anything added after the enable job ran — a new show was
 * invisible to every shared user until someone pressed Reconcile. The nightly
 * sync is now what keeps the label current.
 */
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken, noopCheckpoint, type JobContext } from "@tinkerbell/core";
import { startMockPlex, type MockPlex } from "@tinkerbell/test-support";

import { createSyncMediaCommand } from "./sync-media.ts";

const c = createTestContainer();
after(() => c.dispose());

const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createSyncMediaCommand(c.resolve(ServicesToken));

const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

let plex: MockPlex;
beforeEach(async () => {
  await plex?.close();
  plex = await startMockPlex({
    sections: SECTIONS,
    items: [
      { ratingKey: "1", title: "Labelled Earlier", sectionId: "1", guids: [], labels: ["Tinkerbell"] },
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

    assert.deepEqual(plex.items.get("2")!.labels, ["Disney+ Movies", "Tinkerbell"]);
    assert.deepEqual(
      plex.journal.labelWriteRequests.map((r) => r.ids),
      [["2"]],
    );
    assert.ok(log.some((l) => l.includes("Labelled 1 new item(s)")));
  });

  for (const status of ["disabled", "enabling", "disabling"] as const) {
    it(`labels nothing while personalization is ${status}`, async () => {
      setConfig("global_personalized_sharing", { status });
      await run(testContext().ctx, {});
      assert.deepEqual(plex.journal.labelWriteRequests, []);
    });
  }
});
