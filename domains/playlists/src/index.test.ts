/**
 * This table *is* the record of which playlists Tinkerbell owns — Plex
 * playlists cannot carry a `Rule:<id>` label, so unlike every other entity
 * there is no source of truth to re-derive it from. That makes two properties
 * worth pinning:
 *
 * - **`rememberPlaylist` upserts on `ratingKey`, not on `(ruleId, title)`.** A
 *   run that finds the playlist already there must update the row in place; if
 *   it inserted instead, the same Plex playlist would be recorded twice and
 *   `forgetPlaylist` would only ever clear one of them.
 * - **`getPlaylistForRule` is keyed by rule *and* title.** A rule with
 *   `combineSections: false` owns one playlist per library, and they have to
 *   stay distinguishable — keying on rule alone would hand the generate path
 *   whichever row `.get()` happened to return and it would rewrite the wrong
 *   playlist.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken, managedPlaylists, rules } from "@tinkerbell/db";
import { PlaylistsToken } from "@tinkerbell/domain.playlists";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { getPlaylistForRule, getPlaylistsForRule, listPlaylists, rememberPlaylist, forgetPlaylist } =
  c.resolve(PlaylistsToken);

/** `rule_id` is a real FK, so a playlist needs a rule to hang off. */
function seedRule(id: string): void {
  db.insert(rules).values({ id, name: id, type: "playlist", createdAt: 0 }).run();
}

beforeEach(() => {
  db.delete(managedPlaylists).run();
  db.delete(rules).run();
  seedRule("rule-a");
  seedRule("rule-b");
});

describe("rememberPlaylist", () => {
  test("records a playlist against its rule", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 12 });

    const row = getPlaylistForRule("rule-a", "Movies");
    assert.equal(row?.ratingKey, "100");
    assert.equal(row?.itemCount, 12);
  });

  test("updates in place when the same playlist is seen again", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 12 });
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 30 });

    assert.equal(listPlaylists().length, 1);
    assert.equal(getPlaylistForRule("rule-a", "Movies")?.itemCount, 30);
  });

  test("a renamed playlist keeps one row, under the new title", () => {
    // The rule's title template changed between runs. The Plex playlist is the
    // same object, so the record has to follow it rather than fork.
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 12 });
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Best Movies", itemCount: 12 });

    assert.equal(listPlaylists().length, 1);
    assert.equal(getPlaylistForRule("rule-a", "Movies"), undefined);
    assert.equal(getPlaylistForRule("rule-a", "Best Movies")?.ratingKey, "100");
  });

  test("a playlist reassigned to another rule moves rather than duplicates", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 12 });
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-b", title: "Movies", itemCount: 12 });

    assert.equal(listPlaylists().length, 1);
    assert.deepEqual(getPlaylistsForRule("rule-a"), []);
    assert.equal(getPlaylistsForRule("rule-b").length, 1);
  });

  test("sets createdAt once and moves updatedAt on", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 12 });
    const first = getPlaylistForRule("rule-a", "Movies");

    db.update(managedPlaylists).set({ createdAt: 1_000, updatedAt: 1_000 }).run();
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 13 });

    const second = getPlaylistForRule("rule-a", "Movies");
    assert.equal(second?.createdAt, 1_000, "createdAt is not rewritten by the upsert");
    assert.ok((second?.updatedAt ?? 0) > 1_000, "updatedAt moved");
    assert.ok(first !== undefined);
  });
});

describe("lookups", () => {
  test("a rule with one playlist per library keeps them distinguishable", () => {
    // `combineSections: false` — one rule, two libraries, two playlists.
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies — 4K", itemCount: 5 });
    rememberPlaylist({ ratingKey: "200", ruleId: "rule-a", title: "Movies — HD", itemCount: 7 });

    assert.equal(getPlaylistForRule("rule-a", "Movies — 4K")?.ratingKey, "100");
    assert.equal(getPlaylistForRule("rule-a", "Movies — HD")?.ratingKey, "200");
    assert.equal(getPlaylistsForRule("rule-a").length, 2);
  });

  test("the same title under two rules does not collide", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 5 });
    rememberPlaylist({ ratingKey: "200", ruleId: "rule-b", title: "Movies", itemCount: 7 });

    assert.equal(getPlaylistForRule("rule-a", "Movies")?.ratingKey, "100");
    assert.equal(getPlaylistForRule("rule-b", "Movies")?.ratingKey, "200");
  });

  test("an unknown rule or title is undefined rather than a throw", () => {
    assert.equal(getPlaylistForRule("nobody", "Movies"), undefined);
    assert.deepEqual(getPlaylistsForRule("nobody"), []);
  });
});

describe("forgetPlaylist", () => {
  test("drops only the named playlist", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies — 4K", itemCount: 5 });
    rememberPlaylist({ ratingKey: "200", ruleId: "rule-a", title: "Movies — HD", itemCount: 7 });

    forgetPlaylist("100");

    assert.equal(getPlaylistsForRule("rule-a").length, 1);
    assert.equal(getPlaylistForRule("rule-a", "Movies — HD")?.ratingKey, "200");
  });

  test("forgetting something unknown is a no-op", () => {
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 5 });
    forgetPlaylist("999");
    assert.equal(listPlaylists().length, 1);
  });

  test("deleting the rule takes its playlist records with it", () => {
    // `rule_id` cascades. Without it a deleted rule would leave rows claiming
    // ownership of Plex playlists on behalf of a rule that no longer exists,
    // and `rememberPlaylist` would then upsert against a dangling FK.
    rememberPlaylist({ ratingKey: "100", ruleId: "rule-a", title: "Movies", itemCount: 5 });
    rememberPlaylist({ ratingKey: "200", ruleId: "rule-b", title: "Shows", itemCount: 7 });

    db.delete(rules).where(eq(rules.id, "rule-a")).run();

    assert.deepEqual(getPlaylistsForRule("rule-a"), []);
    assert.equal(getPlaylistsForRule("rule-b").length, 1, "the other rule's playlist is untouched");
  });
});
