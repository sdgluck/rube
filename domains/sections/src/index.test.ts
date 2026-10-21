/**
 * `syncSections` ends with a bulk `delete where syncedAt < now`, which is the
 * same sweep pattern `domains/collections` and `domains/media` use. It is the
 * right shape — one statement, no read-then-write race — and it has one
 * property worth knowing about: **it trusts the response completely**. A Plex
 * that answers with a short list, or an empty one, takes the missing sections
 * with it.
 *
 * Section keys are referenced by rules, overlays and media, so that is not a
 * cosmetic loss. The behaviour is asserted here rather than fixed, because
 * "Plex returned fewer sections" is genuinely ambiguous — a library really can
 * be deleted — and guessing wrong in the other direction leaves rows nobody can
 * remove. What the test buys is that the trade is visible, and that a future
 * guard has a place to hang.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, plexSections } from "@rube/db";
import { SectionsToken } from "@rube/domain.sections";
import type { PlexClient } from "@rube/plex";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { syncSections, getLocalSections } = c.resolve(SectionsToken);

/** Only `getSections` is reached, so the rest of the client stays absent. */
function clientReturning(sections: Array<{ key: string; title: string; type: string }>): PlexClient {
  return { getSections: async () => sections } as unknown as PlexClient;
}

/**
 * The sweep is `delete where syncedAt < now`, and `now` is `Date.now()` — so
 * two syncs landing in the same millisecond sweep nothing, because the second
 * pass's `now` is not greater than the first pass's `syncedAt`.
 *
 * Every test below that syncs twice and asserts a removal depends on the clock
 * having moved between them. It used to, by accident, when the suite was slow.
 * Waiting for the millisecond to actually tick makes that dependency explicit
 * and the result deterministic, instead of a test that passes on a loaded
 * machine and fails on an idle one.
 */
async function tick(): Promise<void> {
  const started = Date.now();
  while (Date.now() === started) await new Promise((r) => setImmediate(r));
}

function keys(): string[] {
  return getLocalSections()
    .map((s) => s.key)
    .sort();
}

beforeEach(() => {
  db.delete(plexSections).run();
});

describe("syncSections", () => {
  test("inserts what Plex reports", async () => {
    const stats = await syncSections(
      clientReturning([
        { key: "1", title: "Movies", type: "movie" },
        { key: "2", title: "TV", type: "show" },
      ]),
    );

    assert.deepEqual(stats, { synced: 2, removed: 0 });
    assert.deepEqual(keys(), ["1", "2"]);
  });

  test("updates a renamed section in place rather than duplicating it", async () => {
    // The key is the identity. A rename that inserted instead would leave two
    // rows for one library, and rules pointing at the key would see both.
    await syncSections(clientReturning([{ key: "1", title: "Movies", type: "movie" }]));
    await syncSections(clientReturning([{ key: "1", title: "Films", type: "movie" }]));

    const local = getLocalSections();
    assert.equal(local.length, 1);
    assert.equal(local[0]?.title, "Films");
  });

  test("a changed type is carried through", async () => {
    await syncSections(clientReturning([{ key: "1", title: "Mixed", type: "movie" }]));
    await syncSections(clientReturning([{ key: "1", title: "Mixed", type: "show" }]));
    assert.equal(getLocalSections()[0]?.type, "show");
  });

  test("a section Plex no longer reports is removed, and counted", async () => {
    await syncSections(
      clientReturning([
        { key: "1", title: "Movies", type: "movie" },
        { key: "2", title: "TV", type: "show" },
      ]),
    );
    await tick();

    const stats = await syncSections(clientReturning([{ key: "1", title: "Movies", type: "movie" }]));

    assert.deepEqual(stats, { synced: 1, removed: 1 });
    assert.deepEqual(keys(), ["1"]);
  });

  test("a repeat sync removes nothing", async () => {
    const sections = [
      { key: "1", title: "Movies", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ];
    await syncSections(clientReturning(sections));
    const stats = await syncSections(clientReturning(sections));

    assert.deepEqual(stats, { synced: 2, removed: 0 });
    assert.deepEqual(keys(), ["1", "2"]);
  });

  test("an empty response empties the table — the sweep trusts Plex completely", () => {
    // Documented rather than defended. If this ever needs a floor ("refuse to
    // sweep everything when the previous sync saw sections"), this is the test
    // that should change, deliberately, rather than a surprise in the field.
    return (async () => {
      await syncSections(clientReturning([{ key: "1", title: "Movies", type: "movie" }]));
      await tick();

      const stats = await syncSections(clientReturning([]));

      assert.deepEqual(stats, { synced: 0, removed: 1 });
      assert.deepEqual(keys(), []);
    })();
  });

  test("a failing Plex leaves the table untouched", async () => {
    // The important half of the above: the sweep runs *after* the fetch, so an
    // error means nothing is deleted. Only a successful short answer is
    // destructive.
    await syncSections(clientReturning([{ key: "1", title: "Movies", type: "movie" }]));

    const failing = {
      getSections: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    } as unknown as PlexClient;

    await assert.rejects(() => syncSections(failing));
    assert.deepEqual(keys(), ["1"], "the previous sections survived");
  });

  test("syncing an empty library from scratch is not an error", async () => {
    const stats = await syncSections(clientReturning([]));
    assert.deepEqual(stats, { synced: 0, removed: 0 });
  });
});

describe("getLocalSections", () => {
  test("returns key, title and type only", async () => {
    await syncSections(clientReturning([{ key: "1", title: "Movies", type: "movie" }]));
    assert.deepEqual(getLocalSections(), [{ key: "1", title: "Movies", type: "movie" }]);
  });

  test("is empty before the first sync", () => {
    assert.deepEqual(getLocalSections(), []);
  });
});
