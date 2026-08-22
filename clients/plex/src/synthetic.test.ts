/**
 * The one thing keeping the stress harness's fabricated playback out of every
 * number Tinkerbell reports about the server.
 *
 * The harness starts genuine Plex sessions — that is the whole design — so from
 * `/status/sessions` they are indistinguishable from someone watching a film,
 * and everything that reads that endpoint was counting them. A regression here
 * does not fail loudly; it quietly writes twenty fake plays into someone's
 * history and a spike into their bandwidth chart.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SYNTHETIC_CLIENT_PREFIX, isSyntheticSession, realSessions, syntheticSessions } from "./synthetic.ts";

const stress = { playerMachineId: `${SYNTHETIC_CLIENT_PREFIX}9f2c1a04` };
const person = { playerMachineId: "9d8c1f2a-4b3e-4c1d-8f7a-2b1c3d4e5f60" };
const anonymous = {};

describe("isSyntheticSession", () => {
  it("recognises a session the harness fabricated", () => {
    assert.equal(isSyntheticSession(stress), true);
  });

  it("does not claim a real client", () => {
    assert.equal(isSyntheticSession(person), false);
    assert.equal(isSyntheticSession({ playerMachineId: "Plex Web" }), false);
  });

  it("treats a session with no player id as real", () => {
    // Plex omits the machine identifier on some clients. Guessing "synthetic"
    // there would silently drop a real person's play from their own history,
    // which is a far worse failure than keeping a fake one.
    assert.equal(isSyntheticSession(anonymous), false);
  });

  it("does not match a prefix that merely contains ours", () => {
    assert.equal(isSyntheticSession({ playerMachineId: "not-tinkerbell-stress-1" }), false);
  });
});

describe("realSessions / syntheticSessions", () => {
  const all = [person, stress, anonymous];

  it("splits the list without losing anything", () => {
    assert.deepEqual(realSessions(all), [person, anonymous]);
    assert.deepEqual(syntheticSessions(all), [stress]);
    assert.equal(realSessions(all).length + syntheticSessions(all).length, all.length);
  });

  it("leaves the caller's array alone", () => {
    const input = [...all];
    realSessions(input);
    assert.equal(input.length, 3);
  });
});
