import assert from "node:assert/strict";
import { test } from "node:test";

import { queueState } from "./queue-state.ts";

test("an item the client has paused says paused, not downloading", () => {
  assert.deepEqual(queueState({ trackedDownloadState: "downloading", status: "paused" }), {
    label: "paused",
    tone: "advisory",
  });
});

test("an item actually downloading says so, unflagged", () => {
  assert.deepEqual(queueState({ trackedDownloadState: "downloading", status: "downloading" }), {
    label: "downloading",
  });
});

test("an unreachable client is an error", () => {
  assert.equal(queueState({ trackedDownloadState: "downloading", status: "downloadClientUnavailable" }).tone, "error");
});

test("once past the client, the import pipeline's state is shown", () => {
  assert.deepEqual(queueState({ trackedDownloadState: "importing", status: "completed" }), { label: "importing" });
});

test("a status this table doesn't know is shown verbatim", () => {
  assert.deepEqual(queueState({ status: "somethingNew" }), { label: "somethingNew" });
  assert.deepEqual(queueState({}), { label: "—" });
});
