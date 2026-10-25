/**
 * Shuffling is unpin-everything-then-pin-in-a-new-order, because re-pinning
 * appends a hub to the end of the section's list. That leaves a window with no collection rows on the home
 * screen at all — and this runs every thirty minutes against a server that is
 * routinely slow, so the window is entered often. A failure inside it used to
 * end with most of the hubs simply gone until the next run.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pinFirstInSection, shuffleSectionHubs } from "./index.ts";
import type { PlexClient, PlexSection } from "@rube/plex";

const SECTION: PlexSection = { key: "1", title: "Films", type: "movie" };

function hub(id: string) {
  return {
    identifier: `custom.collection.${id}.${id}00`,
    title: `Hub ${id}`,
    promotedToOwnHome: 1,
    promotedToRecommended: 0,
    promotedToSharedHome: 1,
  };
}

/**
 * A client that records pins and unpins, and can be told to fail on the Nth
 * pin. `order()` is the section's list as Plex would now return it: an unpin
 * removes a hub, a pin appends it.
 */
function fakeClient(hubs: ReturnType<typeof hub>[], failOnPin?: number) {
  const pinned: string[] = [];
  const unpinned: string[] = [];
  let list = hubs.map((h) => h.identifier.split(".").pop()!);
  let pins = 0;
  let reads = 0;
  const client = {
    async getManagedHubs() {
      reads++;
      return hubs;
    },
    async unpinFromHomepage(_sectionKey: string, identifier: string) {
      unpinned.push(identifier);
      const key = identifier.split(".").pop();
      list = list.filter((k) => k !== key);
    },
    async pinToHomepage(_sectionKey: string, ratingKey: string) {
      pins++;
      if (failOnPin != null && pins === failOnPin) throw new Error("Plex said 500");
      pinned.push(ratingKey);
      list.push(ratingKey);
    },
  } as unknown as PlexClient;
  return { client, pinned, unpinned, order: () => list, reads: () => reads };
}

describe("shuffleSectionHubs", () => {
  test("pins every hub back", async () => {
    const hubs = ["a", "b", "c"].map(hub);
    const { client, pinned, unpinned } = fakeClient(hubs);
    const result = await shuffleSectionHubs(client, SECTION);
    assert.equal(result.shuffled, 3);
    assert.equal(unpinned.length, 3);
    assert.deepEqual(pinned.sort(), ["a00", "b00", "c00"]);
  });

  test("does nothing at all with fewer than two hubs", async () => {
    const { client, unpinned } = fakeClient([hub("a")]);
    const result = await shuffleSectionHubs(client, SECTION);
    assert.deepEqual(result, { sectionTitle: "Films", shuffled: 0, skipped: 1 });
    assert.deepEqual(unpinned, [], "nothing is taken down when nothing can be reordered");
  });

  test("a failure partway puts back every hub it took down", async () => {
    // The order will be wrong, which is all shuffling was for and costs nothing.
    // Missing rows are what people notice.
    const hubs = ["a", "b", "c", "d"].map(hub);
    const { client, pinned } = fakeClient(hubs, 3);
    await assert.rejects(() => shuffleSectionHubs(client, SECTION), /Plex said 500/);
    assert.deepEqual(pinned.sort(), ["a00", "b00", "c00", "d00"], "every hub is pinned again");
  });
});

describe("keeping hubs at the top", () => {
  test("a shuffle never takes a kept hub down, and leaves it first", async () => {
    const hubs = ["a", "b", "c", "d"].map(hub);
    const { client, unpinned, order } = fakeClient(hubs);
    const result = await shuffleSectionHubs(client, SECTION, undefined, { keepFirst: new Set(["c00"]) });
    assert.equal(result.shuffled, 3);
    assert.ok(!unpinned.some((id) => id.endsWith(".c00")), "the kept hub stays pinned throughout");
    assert.equal(order()[0], "c00");
  });

  test("kept hubs don't count towards the two a shuffle needs", async () => {
    const { client, unpinned } = fakeClient(["a", "b"].map(hub));
    const result = await shuffleSectionHubs(client, SECTION, undefined, { keepFirst: new Set(["a00"]) });
    assert.equal(result.shuffled, 0);
    assert.deepEqual(unpinned, []);
  });

  test("already in order costs one read and no writes", async () => {
    const { client, pinned, unpinned, reads } = fakeClient(["a", "b", "c"].map(hub));
    const moved = await pinFirstInSection(client, SECTION, new Set(["a00", "b00"]));
    assert.equal(moved, 0);
    assert.equal(reads(), 1);
    assert.deepEqual([...pinned, ...unpinned], []);
  });

  test("moves the other hubs behind a kept hub that fell behind, keeping their order", async () => {
    // A new row is pinned at the bottom — the case this runs after every job for.
    const { client, unpinned, order } = fakeClient(["a", "b", "c", "d"].map(hub));
    const moved = await pinFirstInSection(client, SECTION, new Set(["b00", "d00"]));
    assert.equal(moved, 2);
    assert.ok(!unpinned.some((id) => id.endsWith(".b00") || id.endsWith(".d00")));
    assert.deepEqual(order(), ["b00", "d00", "a00", "c00"]);
  });

  test("a failure partway still puts every hub back, kept ones first", async () => {
    const { client, order } = fakeClient(["a", "b", "c", "d"].map(hub), 2);
    await assert.rejects(() => pinFirstInSection(client, SECTION, new Set(["d00"])), /Plex said 500/);
    assert.equal(order()[0], "d00");
    assert.deepEqual([...order()].sort(), ["a00", "b00", "c00", "d00"]);
  });
});
