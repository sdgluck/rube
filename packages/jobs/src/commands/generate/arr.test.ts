/**
 * Where a rule's missing items land, against mock Radarr and Sonarr over HTTP.
 *
 * A rule used to carry one target, applied to both services — so a mixed
 * list sent its shows to Sonarr with a Radarr quality profile id and a Radarr
 * root folder. These pin that each service gets its own target, that a
 * service the rule has no target for is never written to, and that a rule
 * saved in the old shape only reaches the service it was configured for.
 */
import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@tinkerbell/core";
import { ConfigStoreToken, noopCheckpoint } from "@tinkerbell/core";
import { ServicesToken } from "@tinkerbell/composition";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { startMockRadarr, startMockSonarr, type MockArr } from "@tinkerbell/test-support";
import { createArrCommand } from "./arr.ts";

const c = createTestContainer();
after(() => c.dispose());
const { setConfig } = c.resolve(ConfigStoreToken);
const { pushToArr } = createArrCommand(c.resolve(ServicesToken));

const shared = { enabled: true, monitor: true, searchOnAdd: false, maxAddsPerRun: 25, dryRun: false };
const film = { externalId: "tmdb:1", mediaType: "movie" as const, displayName: "Film" };
const show = { externalId: "tmdb:2", mediaType: "tv" as const, displayName: "Show" };

let radarr: MockArr;
let sonarr: MockArr;

function testContext(): { ctx: JobContext; log: string[] } {
  const lines: string[] = [];
  return {
    log: lines,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

async function servers(opts: { radarrFinds?: boolean } = {}) {
  radarr = await startMockRadarr([], {
    lookupResults: opts.radarrFinds === false ? [] : [{ title: "Film", tmdbId: 1 }],
  });
  sonarr = await startMockSonarr([], { lookupResults: [{ title: "Show", tvdbId: 2 }] });
  setConfig("global_radarr_url", radarr.origin);
  setConfig("global_radarr_api_key", "key");
  setConfig("global_sonarr_url", sonarr.origin);
  setConfig("global_sonarr_api_key", "key");
}

describe("pushToArr", () => {
  beforeEach(() => servers());
  afterEach(async () => {
    await radarr.close();
    await sonarr.close();
  });

  it("files films and shows under each service's own profile and folder", async () => {
    const { ctx } = testContext();
    const result = await pushToArr(
      ctx,
      [film, show],
      {
        ...shared,
        radarr: { qualityProfileId: 1, rootFolderPath: "/movies" },
        sonarr: { qualityProfileId: 7, rootFolderPath: "/tv" },
      },
      null,
    );
    assert.equal(result.added, 2);
    assert.equal(radarr.journal.adds.length, 1);
    assert.equal(radarr.journal.adds[0].qualityProfileId, 1);
    assert.equal(radarr.journal.adds[0].rootFolderPath, "/movies");
    assert.equal(sonarr.journal.adds.length, 1);
    assert.equal(sonarr.journal.adds[0].qualityProfileId, 7);
    assert.equal(sonarr.journal.adds[0].rootFolderPath, "/tv");
  });

  it("never writes to a service the rule has no target for", async () => {
    const { ctx, log } = testContext();
    const result = await pushToArr(
      ctx,
      [film, show],
      { ...shared, radarr: { qualityProfileId: 1, rootFolderPath: "/movies" } },
      null,
    );
    assert.deepEqual(result, { added: 1, skipped: 1, failed: 0 });
    assert.deepEqual(sonarr.journal.requests, []);
    assert.ok(log.some((l) => /No sonarr target/.test(l)));
  });

  it("applies an old single-target rule to the service it was configured for only", async () => {
    const { ctx } = testContext();
    const legacy = { ...shared, qualityProfileId: 1, rootFolderPath: "/movies" };
    const result = await pushToArr(ctx, [film, show], legacy, "radarr");
    assert.equal(result.added, 1);
    assert.equal(radarr.journal.adds[0].qualityProfileId, 1);
    assert.deepEqual(sonarr.journal.adds, [], "a Radarr profile id must not reach Sonarr");
  });

  it("tries Radarr then Sonarr for an id that could be either", async () => {
    await radarr.close();
    await sonarr.close();
    await servers({ radarrFinds: false });
    const { ctx } = testContext();
    const result = await pushToArr(
      ctx,
      [{ externalId: "imdb:tt1", mediaType: "either", displayName: "tt1" }],
      {
        ...shared,
        radarr: { qualityProfileId: 1, rootFolderPath: "/movies" },
        sonarr: { qualityProfileId: 7, rootFolderPath: "/tv" },
      },
      null,
    );
    assert.equal(result.added, 1);
    assert.equal(radarr.journal.lookups.length, 1, "asked Radarr first");
    assert.deepEqual(radarr.journal.adds, []);
    assert.equal(sonarr.journal.adds[0].rootFolderPath, "/tv");
  });
});
