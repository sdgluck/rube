/**
 * The live statuses the Settings pages show in place of the paragraphs that
 * used to describe them: daily-cap spend, Plex Pass, and libraries
 * personalization hasn't labelled.
 *
 * Through the router, against the real container: the cap counts are only
 * worth showing if they are the counts the run budget starts from, over the
 * same window, read from the same clock — so the clock is pinned and moved
 * rather than rows being written into the past.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { initTRPC } from "@trpc/server";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { ConfigStoreToken, DAY_MS } from "@rube/core";
import { DbToken, rules } from "@rube/db";
import { JobsToken, registerJobs } from "@rube/jobs";
import { startMockPlex, type MockPlex } from "@rube/test-support";
import { createTrpc } from "./index.ts";
import type { AdminContext } from "./_base.ts";

const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

const c = createTestContainer({ now: T0, overrides: registerJobs });
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { appRouter } = createTrpc({ ...services, jobs: c.resolve(JobsToken) });

function caller() {
  const ctx = {
    session: undefined,
    resHeaders: new Headers(),
    secure: false,
    origin: "http://admin.rube.test",
    ip: "test",
    authRequired: false,
  } as unknown as AdminContext;
  return initTRPC.context<AdminContext>().create().createCallerFactory(appRouter)(ctx);
}

describe("cap usage", () => {
  test("cleanup counts destructive actions in the last 24 hours, by the container's clock", async () => {
    const { recordMatches, markActioned } = services.cleanup;
    c.resolve(DbToken)
      .insert(rules)
      .values({ id: "r1", name: "Old films", type: "smart_filter", config: {}, createdAt: T0 })
      .run();
    recordMatches(
      "r1",
      ["1", "2", "3", "4"].map((ratingKey) => ({ ratingKey, sectionId: "1", title: `Film ${ratingKey}` })),
      T0,
    );
    markActioned("r1", "1", "delete", T0 - 2 * HOUR);
    markActioned("r1", "2", "unmonitor", T0 - 23 * HOUR);
    markActioned("r1", "3", "delete", T0 - 25 * HOUR);
    // Not destructive, so it doesn't spend the ceiling.
    markActioned("r1", "4", "label", T0 - HOUR);

    assert.deepEqual(await caller().cleanup.capUsage(), { used: 2 });

    // Two hours on, the 23-hour-old removal has aged out of the window.
    c.advance(2 * HOUR);
    assert.deepEqual(await caller().cleanup.capUsage(), { used: 1 });
    c.setNow(T0);
  });

  test("metadata counts field writes in the last 24 hours", async () => {
    const write = (ratingKey: string) => ({
      ratingKey,
      sectionId: "1",
      sectionType: "movie",
      itemTitle: `Film ${ratingKey}`,
      field: "title",
      fieldKind: "scalar" as const,
      previousValue: "a",
      previousLocked: false,
      newValue: "b",
    });
    services.metadata.snapshotWrites("b1", null, [write("1"), write("2")], T0 - HOUR);
    services.metadata.snapshotWrites("b2", null, [write("3")], T0 - DAY_MS - 1);

    assert.deepEqual(await caller().metadata.capUsage(), { used: 2 });
    c.advance(DAY_MS);
    assert.deepEqual(await caller().metadata.capUsage(), { used: 0 });
    c.setNow(T0);
  });
});

describe("against a mock Plex", () => {
  let plex: MockPlex;

  before(async () => {
    plex = await startMockPlex({
      plexPass: true,
      sections: [
        { key: "1", title: "Movies", type: "movie" },
        { key: "2", title: "Shows", type: "show" },
        { key: "3", title: "Kids", type: "movie" },
      ],
      items: [
        { ratingKey: "10", title: "Labelled", sectionId: "1", guids: [], labels: ["Rube"] },
        // A new arrival the label job hasn't reached: not an unlabelled library.
        { ratingKey: "11", title: "New", sectionId: "1", guids: [], labels: [] },
        { ratingKey: "20", title: "Added later", sectionId: "2", guids: [], labels: [] },
      ],
    });
    setConfig("global_plex_url", plex.origin);
    setConfig("global_plex_token", "token");
  });
  after(() => plex.close());

  test("Plex Pass is read from the server's identity", async () => {
    assert.equal((await caller().prerolls.plexStatus()).plexPass, true);
  });

  test("a library with nothing labelled is named; a partly labelled or empty one isn't", async () => {
    const estimate = await caller().personalization.estimate();
    assert.deepEqual(estimate.unlabelledLibraries, ["Shows"]);
    assert.equal(estimate.itemCount, 2);
  });
});

describe("without Plex", () => {
  test("Plex Pass is unknown rather than false", async () => {
    setConfig("global_plex_url", "");
    setConfig("global_plex_token", "");
    assert.equal((await caller().prerolls.plexStatus()).plexPass, null);
  });
});
