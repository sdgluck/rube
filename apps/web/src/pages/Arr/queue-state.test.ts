import assert from "node:assert/strict";
import { test } from "node:test";

import { clientItemState, findClientItem, indexClientItems, queueState } from "./queue-state.ts";

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

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: "AAA",
    matchIds: ["aaa"],
    name: "Family.2024",
    state: "downloading",
    paused: false,
    progress: 0,
    size: null,
    sizeLeft: null,
    speed: null,
    message: null,
    ...over,
  }) as never;

test("a queue row finds its client item whatever case the *Arr wrote the id in", () => {
  const index = indexClientItems([
    {
      id: "sab",
      name: "SAB",
      kind: "sabnzbd",
      ok: true,
      status: { paused: true, speed: 0, version: null },
      items: [item()],
    },
    { id: "dead", name: "Gone", kind: "deluge", ok: false, error: "unreachable" },
  ]);
  assert.equal(findClientItem(index, "AAA")?.clientId, "sab");
  assert.equal(findClientItem(index, "bbb"), null);
  assert.equal(findClientItem(index, undefined), null);
});

test("a client item's error says what the client said", () => {
  assert.deepEqual(clientItemState(item({ state: "error", message: "No space left" })), {
    label: "No space left",
    tone: "error",
  });
  assert.deepEqual(clientItemState(item({ state: "paused" })), { label: "paused", tone: "advisory" });
  assert.deepEqual(clientItemState(item()), { label: "downloading" });
});
