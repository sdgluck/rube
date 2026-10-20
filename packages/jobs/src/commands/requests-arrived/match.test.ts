import { test } from "node:test";
import assert from "node:assert/strict";
import type { SeerrRequest } from "@tinkerbell/seerr";
import { arrivedAt, createRequesterMatcher, isArrived, requestsSummary } from "./match.ts";

const USERS = [
  { userId: 10, username: "alice", email: "alice@example.com" },
  { userId: 11, username: "bob", email: null },
];
const match = createRequesterMatcher(USERS);

const req = (over: Partial<SeerrRequest["media"]> = {}): SeerrRequest => ({
  id: 1,
  media: { tmdbId: 1, mediaType: "movie", status: 5, ratingKey: "100", mediaAddedAt: "2026-10-10T00:00:00Z", ...over },
  requestedBy: {},
  createdAt: "2026-09-01T00:00:00Z",
});

test("a requester is matched by plex.tv id before anything else", () => {
  assert.equal(match({ plexId: 11, plexUsername: "alice" })?.username, "bob");
});

test("then by Plex username or Overseerr username, ignoring case, then by email", () => {
  assert.equal(match({ plexUsername: "Alice" })?.username, "alice");
  assert.equal(match({ username: "BOB" })?.username, "bob");
  assert.equal(match({ email: "ALICE@example.com" })?.username, "alice");
  assert.equal(match({ username: "carol", email: "carol@example.com" }), undefined);
});

test("only an arrived request with a Plex key counts", () => {
  assert.equal(isArrived(req()), true);
  assert.equal(isArrived(req({ status: 4 })), true, "partially available");
  assert.equal(isArrived(req({ status: 3 })), false, "still processing");
  assert.equal(isArrived(req({ ratingKey: null })), false, "Overseerr hasn't seen it in Plex");
});

test("arrival is when it reached Plex, or when it was asked for if Overseerr doesn't say", () => {
  assert.equal(arrivedAt(req()), Date.parse("2026-10-10T00:00:00Z"));
  assert.equal(arrivedAt(req({ mediaAddedAt: null })), Date.parse("2026-09-01T00:00:00Z"));
});

test("requestsSummary names a few and counts the rest", () => {
  assert.equal(requestsSummary(["Dune"]), "You asked for these, and they're here: Dune.");
  assert.equal(requestsSummary(["A", "B", "C", "D"]), "You asked for these, and they're here: A, B, C and 1 more.");
});
