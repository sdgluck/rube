/**
 * Shuffling is unpin-everything-then-pin-in-a-new-order, because Plex has no
 * "reorder" call. That leaves a window with no collection rows on the home
 * screen at all — and this runs every thirty minutes against a server that is
 * routinely slow, so the window is entered often. A failure inside it used to
 * end with most of the hubs simply gone until the next run.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { shuffleSectionHubs } from "./index.ts";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

const SECTION: PlexSection = { key: "1", title: "Films", type: "movie" };

function hub(id: string) {
  return {
    identifier: `custom.collection.${id}.${id}00`,
    title: `Hub ${id}`,
    promotedToOwnHome: 1,
    promotedToRecommendedHome: 0,
    promotedToSharedHome: 1,
  };
}

/** A client that records pins and unpins, and can be told to fail on the Nth pin. */
function fakeClient(hubs: ReturnType<typeof hub>[], failOnPin?: number) {
  const pinned: string[] = [];
  const unpinned: string[] = [];
  let pins = 0;
  const client = {
    async getManagedHubs() {
      return hubs;
    },
    async unpinFromHomepage(_sectionKey: string, identifier: string) {
      unpinned.push(identifier);
    },
    async pinToHomepage(_sectionKey: string, ratingKey: string) {
      pins++;
      if (failOnPin != null && pins === failOnPin) throw new Error("Plex said 500");
      pinned.push(ratingKey);
    },
  } as unknown as PlexClient;
  return { client, pinned, unpinned };
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
