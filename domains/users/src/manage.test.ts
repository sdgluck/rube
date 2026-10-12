/**
 * The functions that change real Plex accounts, and had no tests.
 *
 * The one that matters most is `updateContentRatings`. plex.tv keeps a *single*
 * string per media type holding several independent clauses —
 * `contentRating=PG,PG-13|label=Kids` — and Tinkerbell owns the `label=` clause
 * while the admin owns `contentRating=`. Personalization writes
 * `label=Tinkerbell,User:<name>` there, and that clause is what limits a shared
 * user to the collections meant for them. A rating change that *replaced* the
 * string instead of composing over it would drop the label clause, and with it
 * every restriction — or, depending on which way Plex resolves an empty
 * clause, blank the user's library entirely.
 *
 * `setFilterClause` (the primitive) is tested in `clients/plex/src/filters.test.ts`.
 * What was untested is this layer using it: reading the *live* filter from
 * plex.tv rather than the local cache, and keeping the backup row in step so a
 * later personalization disable restores the admin's choice rather than the
 * state from before it.
 *
 * Also here: the owner guard (`requireMutableUser`), which is the only thing
 * standing between a mis-click and the server owner unsharing themselves, and
 * `removeUser`'s two genuinely different modes.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken, plexUserShares, plexUsers, sharingRestrictionBackups } from "@tinkerbell/db";
import { UsersToken } from "@tinkerbell/domain.users";
import type { PlexClient } from "@tinkerbell/plex";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const users = c.resolve(UsersToken);

const MACHINE = "machine-1";
const OWNER = 1;
const FRIEND = 7;

interface Share {
  userId: number;
  sharedServerId: number;
  librarySectionIds: number[];
  filterMovies: string;
  filterTelevision: string;
  filterMusic?: string;
  accepted?: boolean;
  allowSync?: boolean;
  allowTuners?: boolean;
  allowChannels?: boolean;
  allowCameraUpload?: boolean;
}

/** Everything the fake client was asked to do. */
interface Journal {
  settingsWrites: Array<{ userId: number; settings: Record<string, unknown> }>;
  sectionWrites: Array<{ sharedServerId: number; sectionIds: number[] }>;
  unshares: number[];
  unfriends: number[];
}

let shares: Share[] = [];
let journal: Journal;

function client(): PlexClient {
  return {
    getIdentity: async () => ({ machineIdentifier: MACHINE }),
    getSharedServersFull: async (machineId: string) => {
      assert.equal(machineId, MACHINE, "the machine id came from getIdentity, not from a caller");
      return shares;
    },
    updateShareSettings: async (userId: number, settings: Record<string, unknown>) => {
      journal.settingsWrites.push({ userId, settings });
      // Plex applies the write, so the next read sees it.
      const share = shares.find((s) => s.userId === userId);
      if (share) Object.assign(share, settings);
    },
    updateSharedSections: async (_machineId: string, sharedServerId: number, sectionIds: number[]) => {
      journal.sectionWrites.push({ sharedServerId, sectionIds });
      const share = shares.find((s) => s.sharedServerId === sharedServerId);
      if (share) share.librarySectionIds = sectionIds;
    },
    unshareServer: async (_machineId: string, sharedServerId: number) => {
      journal.unshares.push(sharedServerId);
      shares = shares.filter((s) => s.sharedServerId !== sharedServerId);
    },
    removeFriend: async (userId: number) => {
      journal.unfriends.push(userId);
      shares = shares.filter((s) => s.userId !== userId);
    },
  } as unknown as PlexClient;
}

function seedUser(userId: number, over: Record<string, unknown> = {}): void {
  db.insert(plexUsers)
    .values({
      userId,
      username: `user-${userId}`,
      label: `user-${userId}`,
      syncedAt: 0,
      isOwner: 0,
      sharedServerId: 100 + userId,
      ...over,
    })
    .run();
}

const shareRow = (userId = FRIEND) => db.select().from(plexUserShares).where(eq(plexUserShares.userId, userId)).get();

beforeEach(() => {
  db.delete(plexUserShares).run();
  db.delete(sharingRestrictionBackups).run();
  db.delete(plexUsers).run();

  seedUser(OWNER, { isOwner: 1, sharedServerId: null });
  seedUser(FRIEND);

  shares = [
    {
      userId: FRIEND,
      sharedServerId: 100 + FRIEND,
      librarySectionIds: [1, 2],
      filterMovies: "",
      filterTelevision: "",
      accepted: true,
    },
  ];
  journal = { settingsWrites: [], sectionWrites: [], unshares: [], unfriends: [] };
});

describe("the owner guard", () => {
  test("the owner cannot have their libraries changed", async () => {
    await assert.rejects(() => users.updateLibraries(client(), OWNER, [1]), /owner/i);
  });

  test("the owner cannot have their content ratings changed", async () => {
    await assert.rejects(() => users.updateContentRatings(client(), OWNER, { movies: ["PG"] }), /owner/i);
  });

  test("the owner cannot be removed, either way", async () => {
    await assert.rejects(() => users.removeUser(client(), OWNER, "unshare"), /owner/i);
    await assert.rejects(() => users.removeUser(client(), OWNER, "unfriend"), /owner/i);
  });

  test("the guard runs before anything reaches Plex", async () => {
    // A guard that fired after the write would be no guard at all.
    await assert.rejects(() => users.removeUser(client(), OWNER, "unfriend"));
    assert.deepEqual(journal, { settingsWrites: [], sectionWrites: [], unshares: [], unfriends: [] });
  });

  test("an unknown user is refused rather than silently ignored", async () => {
    await assert.rejects(() => users.updateContentRatings(client(), 999, { movies: ["PG"] }), /999/);
  });
});

describe("updateContentRatings", () => {
  test("sets the content rating clause", async () => {
    await users.updateContentRatings(client(), FRIEND, { movies: ["PG", "PG-13"] });

    const write = journal.settingsWrites.at(-1)!;
    assert.equal(write.userId, FRIEND);
    assert.equal(write.settings.filterMovies, "contentRating=PG,PG-13");
  });

  test("PRESERVES the label clause — the whole reason this composes", async () => {
    // If this ever fails, personalization's per-user restriction has been
    // wiped and the user can see the entire library.
    shares[0]!.filterMovies = "label=Tinkerbell,User:sam";

    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });

    const filter = String(journal.settingsWrites.at(-1)!.settings.filterMovies);
    assert.match(filter, /label=Tinkerbell,User:sam/, "the label clause survived");
    assert.match(filter, /contentRating=PG/);
  });

  test("preserves an existing label clause on television too", async () => {
    shares[0]!.filterTelevision = "label=Tinkerbell,User:sam";
    await users.updateContentRatings(client(), FRIEND, { television: ["TV-PG"] });

    const filter = String(journal.settingsWrites.at(-1)!.settings.filterTelevision);
    assert.match(filter, /label=Tinkerbell,User:sam/);
    assert.match(filter, /contentRating=TV-PG/);
  });

  test("replaces only the content rating, leaving an earlier one behind", async () => {
    shares[0]!.filterMovies = "contentRating=R|label=Tinkerbell";
    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });

    const filter = String(journal.settingsWrites.at(-1)!.settings.filterMovies);
    assert.equal(filter, "contentRating=PG|label=Tinkerbell", "the old R is gone, the label is not");
  });

  test("an empty list clears the rating but keeps the labels", async () => {
    // "No ceiling" is a legitimate choice, and it must not take the labels
    // with it.
    shares[0]!.filterMovies = "contentRating=PG|label=Tinkerbell";
    await users.updateContentRatings(client(), FRIEND, { movies: [] });

    const filter = String(journal.settingsWrites.at(-1)!.settings.filterMovies);
    assert.doesNotMatch(filter, /contentRating/);
    assert.match(filter, /label=Tinkerbell/);
  });

  test("a media type not named is left exactly as it was", async () => {
    shares[0]!.filterTelevision = "contentRating=TV-14|label=Tinkerbell";
    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });

    assert.equal(
      journal.settingsWrites.at(-1)!.settings.filterTelevision,
      "contentRating=TV-14|label=Tinkerbell",
      "television was passed through byte-for-byte",
    );
  });

  test("reads the LIVE filter from plex.tv, not the local cache", async () => {
    // The cache can be stale — personalization writes to plex.tv directly. If
    // this composed over the cached row it would restore whatever the label
    // clause was at the last sync, undoing a personalization run.
    db.insert(plexUserShares).values({ userId: FRIEND, filterMovies: "label=STALE", syncedAt: 0 }).run();
    shares[0]!.filterMovies = "label=Tinkerbell,User:fresh";

    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });

    const filter = String(journal.settingsWrites.at(-1)!.settings.filterMovies);
    assert.match(filter, /User:fresh/);
    assert.doesNotMatch(filter, /STALE/);
  });

  test("keeps the personalization backup row in step", async () => {
    // The backup is what a personalization *disable* restores. Left alone, a
    // rating change made while personalization was on would be undone the
    // moment it was switched off.
    db.insert(sharingRestrictionBackups)
      .values({
        sharingId: 1,
        userId: FRIEND,
        username: "user-7",
        filterMovies: "contentRating=R",
        filterTelevision: "",
        capturedAt: 0,
      })
      .run();

    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });

    const backup = db
      .select()
      .from(sharingRestrictionBackups)
      .where(eq(sharingRestrictionBackups.userId, FRIEND))
      .get();
    assert.equal(backup?.filterMovies, "contentRating=PG");
  });

  test("with no backup row, nothing is invented", async () => {
    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });
    assert.equal(db.select().from(sharingRestrictionBackups).all().length, 0);
  });

  test("a user who is not shared is refused before any write", async () => {
    shares = [];
    await assert.rejects(() => users.updateContentRatings(client(), FRIEND, { movies: ["PG"] }));
    assert.deepEqual(journal.settingsWrites, []);
  });

  test("the local cache is refreshed afterwards", async () => {
    await users.updateContentRatings(client(), FRIEND, { movies: ["PG"] });
    assert.equal(shareRow()?.filterMovies, "contentRating=PG");
  });
});

describe("updateLibraries", () => {
  test("writes the new sections and refreshes the cache", async () => {
    await users.updateLibraries(client(), FRIEND, [1, 2, 3]);

    assert.deepEqual(journal.sectionWrites, [{ sharedServerId: 107, sectionIds: [1, 2, 3] }]);
    assert.deepEqual(shareRow()?.sectionIds, [1, 2, 3]);
  });

  test("a user with no share is refused", async () => {
    db.update(plexUsers).set({ sharedServerId: null }).where(eq(plexUsers.userId, FRIEND)).run();
    await assert.rejects(() => users.updateLibraries(client(), FRIEND, [1]));
    assert.deepEqual(journal.sectionWrites, []);
  });
});

describe("removeUser", () => {
  test("unshare revokes this server and clears the local share", async () => {
    db.insert(plexUserShares).values({ userId: FRIEND, syncedAt: 0 }).run();

    await users.removeUser(client(), FRIEND, "unshare");

    assert.deepEqual(journal.unshares, [107]);
    assert.deepEqual(journal.unfriends, [], "the friendship is untouched");
    assert.equal(shareRow(), undefined);
    assert.equal(
      db.select().from(plexUsers).where(eq(plexUsers.userId, FRIEND)).get()?.sharedServerId,
      null,
      "the user row stays, without a share",
    );
  });

  test("unfriend removes the friendship and the user row", async () => {
    await users.removeUser(client(), FRIEND, "unfriend");

    assert.deepEqual(journal.unfriends, [FRIEND]);
    assert.deepEqual(journal.unshares, [], "no separate unshare — the friendship took it");
    assert.equal(db.select().from(plexUsers).where(eq(plexUsers.userId, FRIEND)).get(), undefined);
  });

  test("both modes drop the personalization backup", async () => {
    // Left behind, it would restore stale filters onto a re-invited user.
    for (const mode of ["unshare", "unfriend"] as const) {
      db.delete(plexUsers).run();
      seedUser(FRIEND);
      shares = [
        { userId: FRIEND, sharedServerId: 107, librarySectionIds: [1], filterMovies: "", filterTelevision: "" },
      ];
      db.insert(sharingRestrictionBackups)
        .values({ sharingId: 1, userId: FRIEND, username: "u", filterMovies: "", filterTelevision: "", capturedAt: 0 })
        .run();

      await users.removeUser(client(), FRIEND, mode);

      assert.equal(db.select().from(sharingRestrictionBackups).all().length, 0, `${mode} left a backup behind`);
    }
  });

  test("unshare on a user with no share is refused before touching Plex", async () => {
    db.update(plexUsers).set({ sharedServerId: null }).where(eq(plexUsers.userId, FRIEND)).run();
    await assert.rejects(() => users.removeUser(client(), FRIEND, "unshare"));
    assert.deepEqual(journal.unshares, []);
  });

  test("unfriend works even for a user who was never shared with", async () => {
    // A Plex friend who has no share is still a friend, and removing them is
    // meaningful.
    db.update(plexUsers).set({ sharedServerId: null }).where(eq(plexUsers.userId, FRIEND)).run();
    await assert.doesNotReject(() => users.removeUser(client(), FRIEND, "unfriend"));
    assert.deepEqual(journal.unfriends, [FRIEND]);
  });
});

describe("refreshShare", () => {
  test("caches the share Plex reports", async () => {
    shares[0]!.filterMovies = "contentRating=PG";
    shares[0]!.allowSync = true;

    await users.updateLibraries(client(), FRIEND, [1, 2]);

    const row = shareRow();
    assert.equal(row?.filterMovies, "contentRating=PG");
    assert.equal(row?.allowSync, 1);
  });

  test("a share that has disappeared clears the cache rather than leaving it stale", async () => {
    db.insert(plexUserShares).values({ userId: FRIEND, filterMovies: "contentRating=R", syncedAt: 0 }).run();

    // Settings write succeeds, then the re-read finds nothing — the user was
    // unshared from another device between the two calls.
    const vanishing = {
      ...client(),
      getSharedServersFull: async () => [],
      updateShareSettings: async () => {},
    } as unknown as PlexClient;

    await users.updateSettings(vanishing, FRIEND, {} as never);

    assert.equal(shareRow(), undefined);
    assert.equal(db.select().from(plexUsers).where(eq(plexUsers.userId, FRIEND)).get()?.sharedServerId, null);
  });
});
