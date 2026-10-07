/**
 * `syncUsers` ends with a bulk `delete where syncedAt < now` across three
 * tables, and its docstring makes a promise about when that is safe:
 *
 *   > The enrichment reads. Each is optional detail rather than membership, so
 *   > a plex.tv hiccup degrades the badges instead of emptying the list.
 *
 * That is the contract worth testing, because the two halves fail very
 * differently. `listFriends`, `listHomeUsers`, `getSharedServersFull` and
 * `listPendingInvites` each `catch(() => [])`, so losing one costs an avatar or
 * an email address. `getSharings` has no catch — it *is* membership — so if it
 * throws, nothing is deleted, which is right. What is left uncovered by either
 * is the middle case: `getSharings` **succeeding with a short list**. Then the
 * sweep deletes every user it did not mention, taking friendly names, opt-ins
 * and share caches with them.
 *
 * That last case is asserted here as current behaviour rather than fixed. It is
 * genuinely ambiguous — a user really can be unshared — and the alternative
 * (never trusting a shrinking list) leaves rows nobody can remove. What the
 * test buys is that the trade is visible and has somewhere to hang a guard.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { CollectionsReaderToken } from "@tinkerbell/ports";
import { DbToken, plexInvites, plexUserShares, plexUsers } from "@tinkerbell/db";
import { UsersToken } from "@tinkerbell/domain.users";
import type { PlexClient } from "@tinkerbell/plex";

/** Collections drive the `User:<name>` label counts. */
let collections: Array<{ labels: string[] }> = [];

const c = createTestContainer({
  overrides: (r) => r.replace(CollectionsReaderToken, () => () => ({ items: collections })),
});
after(() => c.dispose());

const db = c.resolve(DbToken);
const { syncUsers } = c.resolve(UsersToken);

const MACHINE = "machine-1";

interface ClientShape {
  sharings: Array<{ userId: number; username: string }>;
  owner: { id: number; username: string } | null;
  accounts: Array<{ id: number; name: string }>;
  history: Array<Record<string, unknown>>;
  friends: unknown;
  homeUsers: unknown;
  shares: unknown;
  invites: unknown;
}

const boom = () => {
  throw new Error("plex.tv is having a moment");
};

function client(over: Partial<ClientShape> = {}): PlexClient {
  const shape: ClientShape = {
    sharings: [{ userId: 7, username: "sam" }],
    owner: { id: 1, username: "owner" },
    accounts: [],
    history: [],
    friends: [],
    homeUsers: [],
    shares: [],
    invites: [],
    ...over,
  };
  const answer = (value: unknown) => async () => (typeof value === "function" ? (value as () => never)() : value);
  return {
    getIdentity: async () => ({ machineIdentifier: MACHINE }),
    getSharings: answer(shape.sharings),
    getOwner: answer(shape.owner),
    getAccounts: answer(shape.accounts),
    getWatchHistory: answer(shape.history),
    listFriends: answer(shape.friends),
    listHomeUsers: answer(shape.homeUsers),
    getSharedServersFull: answer(shape.shares),
    listPendingInvites: answer(shape.invites),
  } as unknown as PlexClient;
}

const usernames = () =>
  db
    .select()
    .from(plexUsers)
    .all()
    .map((u) => u.username)
    .sort();

beforeEach(() => {
  db.delete(plexUserShares).run();
  db.delete(plexInvites).run();
  db.delete(plexUsers).run();
  collections = [];
});

/**
 * The sweep removes rows with `syncedAt < now`, so a second sync inside the
 * same millisecond as the first removes nothing. Every test that syncs twice
 * and asserts a removal waits for the clock to move — see `domains/sections`.
 */
async function tick(): Promise<void> {
  const started = Date.now();
  while (Date.now() === started) await new Promise((r) => setImmediate(r));
}

describe("membership", () => {
  test("records the shared users and the owner", async () => {
    const stats = await syncUsers(client());

    assert.deepEqual(usernames(), ["owner", "sam"]);
    assert.equal(stats.synced, 2);
    assert.equal(stats.removed, 0);
  });

  test("the owner is flagged as such", async () => {
    await syncUsers(client());
    const owner = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "owner");
    assert.equal(owner?.isOwner, 1);
  });

  test("an install with no owner still syncs the shared users", async () => {
    await syncUsers(client({ owner: null }));
    assert.deepEqual(usernames(), ["sam"]);
  });

  test("re-syncing the same users updates rather than duplicates", async () => {
    await syncUsers(client());
    await syncUsers(client());
    assert.deepEqual(usernames(), ["owner", "sam"]);
  });

  test("a user who is no longer shared is removed", async () => {
    await syncUsers(
      client({
        sharings: [
          { userId: 7, username: "sam" },
          { userId: 8, username: "kim" },
        ],
      }),
    );
    assert.deepEqual(usernames(), ["kim", "owner", "sam"]);
    await tick();

    const stats = await syncUsers(client({ sharings: [{ userId: 7, username: "sam" }] }));

    assert.deepEqual(usernames(), ["owner", "sam"]);
    assert.equal(stats.removed, 1);
  });
});

describe("degrading rather than emptying", () => {
  const ENRICHMENTS = ["friends", "homeUsers", "shares", "invites"] as const;

  test("a failing enrichment read costs badges, not the user list", async () => {
    // The promise the docstring makes. Each of these is wrapped in a
    // `catch(() => [])` for exactly this reason.
    for (const failing of ENRICHMENTS) {
      db.delete(plexUsers).run();

      const stats = await syncUsers(client({ [failing]: boom } as never));

      assert.deepEqual(usernames(), ["owner", "sam"], `${failing} failing emptied the list`);
      assert.equal(stats.synced, 2);
    }
  });

  test("every enrichment failing at once still keeps the list", async () => {
    // A plex.tv outage hits all four together, which is the realistic case and
    // the one where an unguarded read would wipe everything.
    const stats = await syncUsers(client({ friends: boom, homeUsers: boom, shares: boom, invites: boom } as never));

    assert.deepEqual(usernames(), ["owner", "sam"]);
    assert.equal(stats.synced, 2);
  });

  test("a failing membership read aborts before the sweep", async () => {
    // `getSharings` has no catch, deliberately: it *is* membership, and an
    // empty answer from a broken call would delete everyone. Throwing means the
    // delete never runs.
    await syncUsers(client());
    assert.deepEqual(usernames(), ["owner", "sam"]);

    await assert.rejects(() => syncUsers(client({ sharings: boom } as never)));

    assert.deepEqual(usernames(), ["owner", "sam"], "the previous users survived");
  });

  test("a failing identity read aborts before anything is written", async () => {
    await syncUsers(client());
    const failing = { ...client(), getIdentity: boom } as unknown as PlexClient;

    await assert.rejects(() => syncUsers(failing));

    assert.deepEqual(usernames(), ["owner", "sam"]);
  });

  test("KNOWN RISK: a successful but short sharings list deletes the rest", async () => {
    // The gap between the two cases above. plex.tv answering 200 with a partial
    // list is indistinguishable here from the user genuinely unsharing
    // everyone, and the sweep believes it.
    //
    // Asserted rather than fixed: the alternatives (a floor, a percentage
    // guard, a two-strikes rule) all leave rows that cannot be removed when the
    // shrink is real. If that trade is ever revisited, this is the test to
    // change.
    await syncUsers(
      client({
        sharings: [
          { userId: 7, username: "sam" },
          { userId: 8, username: "kim" },
        ],
      }),
    );
    await tick();

    const stats = await syncUsers(client({ sharings: [], owner: null }));

    assert.deepEqual(usernames(), []);
    assert.equal(stats.removed, 3);
  });
});

describe("enrichment", () => {
  test("counts a user's personal collections from their label", async () => {
    collections = [
      { labels: ["User:sam", "Tinkerbell"] },
      { labels: ["User:sam"] },
      { labels: ["User:kim"] },
      { labels: [] },
    ];

    await syncUsers(client());

    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.collectionCount, 2);
  });

  test("a user with no collections counts zero rather than null", async () => {
    await syncUsers(client());
    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.collectionCount, 0);
  });

  test("matches watch history by account id", async () => {
    await syncUsers(
      client({
        accounts: [{ id: 42, name: "sam" }],
        sharings: [{ userId: 42, username: "sam" }],
        history: [{ accountID: 42, title: "Arrival", viewedAt: 1_000, ratingKey: "rk1" }],
      }),
    );

    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.lastWatchedTitle, "Arrival");
    assert.equal(sam?.lastWatchedRatingKey, "rk1");
  });

  test("falls back to matching an account by lower-cased name", async () => {
    // The sharing id and the local account id are different numbering schemes
    // and do not always agree; the name is the fallback.
    await syncUsers(
      client({
        accounts: [{ id: 99, name: "SAM" }],
        sharings: [{ userId: 7, username: "sam" }],
        history: [{ accountID: 99, title: "Dune", viewedAt: 1_000 }],
      }),
    );

    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.lastWatchedTitle, "Dune");
  });

  test("an episode is titled show — episode", async () => {
    await syncUsers(
      client({
        accounts: [{ id: 42, name: "sam" }],
        sharings: [{ userId: 42, username: "sam" }],
        history: [{ accountID: 42, title: "The Beginning", grandparentTitle: "Severance", viewedAt: 1 }],
      }),
    );

    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.lastWatchedTitle, "Severance — The Beginning");
  });

  test("only the most recent history entry is kept per account", async () => {
    await syncUsers(
      client({
        accounts: [{ id: 42, name: "sam" }],
        sharings: [{ userId: 42, username: "sam" }],
        // The API returns newest first.
        history: [
          { accountID: 42, title: "Newest", viewedAt: 3 },
          { accountID: 42, title: "Older", viewedAt: 2 },
        ],
      }),
    );

    const sam = db
      .select()
      .from(plexUsers)
      .all()
      .find((u) => u.username === "sam");
    assert.equal(sam?.lastWatchedTitle, "Newest");
  });

  test("a share is cached alongside the user", async () => {
    await syncUsers(
      client({
        shares: [
          {
            userId: 7,
            sharedServerId: 500,
            librarySectionIds: [1, 2],
            filterMovies: "contentRating=PG",
            filterTelevision: "",
            filterMusic: "",
            accepted: true,
            allowSync: true,
          },
        ],
      }),
    );

    const share = db.select().from(plexUserShares).all()[0];
    assert.equal(share?.userId, 7);
    assert.deepEqual(share?.sectionIds, [1, 2]);
    assert.equal(share?.filterMovies, "contentRating=PG");
    assert.equal(share?.allowSync, 1);
  });

  test("pending invites are recorded and counted", async () => {
    const stats = await syncUsers(
      client({ invites: [{ id: 1, direction: "outgoing", username: "kim", email: "k@example.com" }] }),
    );

    assert.equal(stats.invites, 1);
    assert.equal(db.select().from(plexInvites).all().length, 1);
  });

  test("an invite that has been accepted since is swept", async () => {
    await syncUsers(client({ invites: [{ id: 1, direction: "outgoing", username: "kim" }] }));
    await tick();
    await syncUsers(client({ invites: [] }));
    assert.equal(db.select().from(plexInvites).all().length, 0);
  });
});
