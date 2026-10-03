/**
 * The library-wide label passes behind personalization, against the mock Plex
 * over real HTTP.
 *
 * The mock now models what a real server did when this was checked: listing
 * rows carry no `Label`, an indexed tag PUT adds rather than replaces, and
 * removal needs the explicit `label[].tag.tag-=` form. Against the old mock —
 * labels on every row, PUTs that replaced — the pass looked like it skipped
 * labelled items and preserved others by merging, while on a real server it
 * re-labelled the whole library on every run.
 */
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createPlexClient } from "@tinkerbell/plex";
import { startMockPlex, type MockPlex } from "@tinkerbell/test-support";

const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

/** 250 films: the first 120 already labelled, every tenth with a label of its own. */
function films() {
  return Array.from({ length: 250 }, (_, i) => ({
    ratingKey: String(i + 1),
    title: `Film ${i + 1}`,
    sectionId: "1",
    guids: [],
    labels: [...(i < 120 ? ["Tinkerbell"] : []), ...(i % 10 === 0 ? ["Disney+ Movies"] : [])],
  }));
}

let plex: MockPlex;
beforeEach(async () => {
  await plex?.close();
  plex = await startMockPlex({ sections: SECTIONS, items: films() });
});
after(() => plex.close());

const client = () => createPlexClient({ url: plex.origin, token: "t" });
const labelsOf = (key: string) => plex.items.get(key)!.labels;

describe("addLabelToAllItems", () => {
  it("touches only the items missing the label, in batches", async () => {
    const updated = await client().addLabelToAllItems("1", "movie", "Tinkerbell");

    assert.equal(updated, 130);
    // 130 items is two requests, not 130 — and not 250, which is what reading
    // `Label` off a listing that never carries it produced.
    assert.deepEqual(
      plex.journal.labelWriteRequests.map((r) => r.ids.length),
      [100, 30],
    );
    for (const item of plex.items.values()) assert.ok(item.labels.includes("Tinkerbell"), item.title);
  });

  it("keeps the labels an item already had", async () => {
    await client().addLabelToAllItems("1", "movie", "Tinkerbell");
    assert.deepEqual(labelsOf("121"), ["Disney+ Movies", "Tinkerbell"]);
  });

  it("does nothing on a library that is already labelled", async () => {
    // The Reconcile button's case: it used to cost a full pass every time.
    await client().addLabelToAllItems("1", "movie", "Tinkerbell");
    plex.journal.labelWriteRequests.length = 0;

    assert.equal(await client().addLabelToAllItems("1", "movie", "Tinkerbell"), 0);
    assert.deepEqual(plex.journal.labelWriteRequests, []);
  });
});

describe("removeLabelFromAllItems", () => {
  it("removes the label explicitly, in batches, leaving the others", async () => {
    const updated = await client().removeLabelFromAllItems("1", "movie", "Tinkerbell");

    assert.equal(updated, 120);
    assert.deepEqual(
      plex.journal.labelWriteRequests.map((r) => r.ids.length),
      [100, 20],
    );
    for (const item of plex.items.values()) assert.ok(!item.labels.includes("Tinkerbell"), item.title);
    assert.deepEqual(labelsOf("1"), ["Disney+ Movies"]);
  });
});

describe("itemLabelsBySection", () => {
  it("reads labels that the listing rows leave out", async () => {
    const labels = await client().itemLabelsBySection("1");
    assert.deepEqual(labels.get("1")?.sort(), ["Disney+ Movies", "Tinkerbell"]);
    assert.deepEqual(labels.get("2"), ["Tinkerbell"]);
    assert.equal(labels.get("200"), undefined);
  });
});

describe("getSectionItemCount", () => {
  it("counts what a label filter leaves, for the enable estimate", async () => {
    assert.equal(await client().getSectionItemCount("1", { "label!": "Tinkerbell" }), 130);
  });
});
