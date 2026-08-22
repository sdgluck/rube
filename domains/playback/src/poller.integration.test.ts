/**
 * The poller against a real HTTP mock Plex, for one property: Tinkerbell's own
 * simulated playback must leave no trace in anything Tinkerbell reports.
 *
 * The stress harness starts genuine Plex sessions on purpose — a fake one would
 * measure nothing — so from `/status/sessions` they are indistinguishable from
 * someone watching a film. Every reader of that endpoint was therefore counting
 * them: a twenty-session ramp landed in playback history as twenty plays by the
 * server owner, and put a spike in the bandwidth series that no viewer caused.
 * The tool that measures the server was corrupting the record of what the server
 * had done.
 *
 * A mock server rather than a stub, per this repo's rule: the filter has to
 * survive the real parse of a real `/status/sessions` payload, and the field it
 * keys on (`Player.machineIdentifier`) is exactly the sort of thing a stub would
 * agree with the code about and a server would not.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, playbackSessions, bandwidthSamples } from "@tinkerbell/db";
import { ConfigStoreToken } from "@tinkerbell/core";
import { SYNTHETIC_CLIENT_PREFIX } from "@tinkerbell/plex";
import type { MockPlex } from "@tinkerbell/test-support";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { pollPlaybackOnce } = services.playback;

const { startMockPlex } = await import("@tinkerbell/test-support");

const ITEMS = [
  { ratingKey: "1", title: "A Real Film", sectionId: "1", guids: [], labels: [], duration: 5_400_000 },
  { ratingKey: "2", title: "Also Real", sectionId: "1", guids: [], labels: [], duration: 5_400_000 },
];

let plex: MockPlex;

before(async () => {
  plex = await startMockPlex({ sections: [{ key: "1", title: "Films", type: "movie" }], items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "tok");
});

beforeEach(() => {
  db.delete(playbackSessions).run();
  db.delete(bandwidthSamples).run();
  plex.playback.sessions.clear();
});

after(() => plex?.close());

/** Put a session on the mock's `/status/sessions` under a given client id. */
function playing(clientId: string, ratingKey: string): void {
  plex.playback.sessions.set(clientId, { ratingKey, clientId });
}

describe("the poller and Tinkerbell's own simulated playback", () => {
  it("records a real viewer", () => {
    // The control. Without it, an assertion that nothing was recorded would
    // pass just as well against a poller that records nothing at all.
    playing("9d8c1f2a-4b3e-4c1d-8f7a-2b1c3d4e5f60", "1");
    return pollPlaybackOnce(undefined, 1_000_000).then((result) => {
      assert.equal(result.opened, 1);
      assert.equal(db.select().from(playbackSessions).all().length, 1);
    });
  });

  it("does not open a playback session for a stress-test stream", async () => {
    playing(`${SYNTHETIC_CLIENT_PREFIX}9f2c1a04`, "1");
    const result = await pollPlaybackOnce(undefined, 1_000_000);

    assert.equal(result.opened, 0);
    assert.equal(db.select().from(playbackSessions).all().length, 0, "a stress stream became someone's watch history");
  });

  it("keeps the real viewer when a stress run is happening alongside them", async () => {
    // The case that matters: a run started while somebody was genuinely
    // watching. Dropping their play would be a worse bug than keeping the fake
    // ones, so the filter has to be per-session rather than per-tick.
    playing("9d8c1f2a-4b3e-4c1d-8f7a-2b1c3d4e5f60", "1");
    for (let i = 0; i < 5; i++) playing(`${SYNTHETIC_CLIENT_PREFIX}s${i}`, "2");

    const result = await pollPlaybackOnce(undefined, 1_000_000);

    assert.equal(result.opened, 1);
    const rows = db.select().from(playbackSessions).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ratingKey, "1", "the row kept is the real viewer's, not a stress session's");
  });

  it("leaves the bandwidth series showing what viewers cost, not what the harness cost", async () => {
    // The series is the denominator on the Stats bandwidth tile. A ramp to
    // twenty transcodes would otherwise write a peak nobody watching caused,
    // and it would stay in the 24h chart long after the run ended.
    for (let i = 0; i < 5; i++) playing(`${SYNTHETIC_CLIENT_PREFIX}s${i}`, "1");
    await pollPlaybackOnce(undefined, 1_000_000);

    const [sample] = db.select().from(bandwidthSamples).all();
    assert.ok(sample, "a tick still writes a sample — a gap would read as a stopped poller");
    assert.equal(sample.streams, 0);
    assert.equal(sample.kbps, 0);
  });
});
