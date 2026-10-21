/**
 * Authorisation, as distinct from authentication.
 *
 * `portal-surface.test.ts` proves every portal procedure needs *a* session.
 * This proves a session only reaches its *own* data — which is a different
 * property, and the one that matters on a port the user is told they may expose
 * publicly. Every read in `portal.router.ts` derives its subject from
 * `ctx.session.userId` rather than from an input, and that is the invariant:
 * there is no procedure a signed-in user can aim at somebody else.
 *
 * The second half is library scoping. `sharedSectionKeys` exists because
 * everything the portal listed used to be server-wide: a user shared only "Kids
 * Movies" could search the whole library by title and was warned about films
 * leaving a library they cannot open. Its convention is subtle and worth
 * pinning — an *empty* list means "no restriction", not "nothing", so a user
 * with an unfiltered share and a user with a share of no libraries are the same
 * thing here, and the owner (who has no share row at all) is unrestricted.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { initTRPC } from "@trpc/server";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import {
  DbToken,
  cleanupCandidates,
  jobRuns,
  jobs,
  mediaItems,
  plexUserShares,
  plexUsers,
  rules,
  userPreferences,
} from "@rube/db";
import { JobsToken, registerJobs } from "@rube/jobs";
import { createTrpc } from "./index.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const db = c.resolve(DbToken);
const services = c.resolve(ServicesToken);
const { portalRouter } = createTrpc({ ...services, jobs: c.resolve(JobsToken) });

type PortalContext = import("./portal.router.ts").PortalContext;

const ALICE = 11;
const BOB = 22;

function callerFor(userId: number, username: string) {
  const ctx: PortalContext = {
    session: { userId, username },
    rawToken: "token",
    resHeaders: new Headers(),
    secure: false,
    handshakeNonce: undefined,
    origin: "http://portal.rube.test",
    ip: "test",
  };
  return initTRPC.context<PortalContext>().create().createCallerFactory(portalRouter)(ctx);
}

function seedUser(userId: number, username: string, sectionIds: number[] | null): void {
  db.insert(plexUsers)
    .values({ userId, username, label: `User:${username}`, syncedAt: 0 })
    .run();
  if (sectionIds) {
    db.insert(plexUserShares).values({ userId, sectionIds, syncedAt: 0 }).run();
  }
}

function seedMedia(ratingKey: string, title: string, sectionId: string): void {
  db.insert(mediaItems)
    .values({ ratingKey, title, sectionId, sectionTitle: `Section ${sectionId}`, type: "movie", syncedAt: 0 })
    .run();
}

/**
 * Cleanup able to act — the switch on and a fresh library sync — because the
 * Leaving soon tab is off without the switch, and the list is empty without
 * both. A scoping test against an empty list proves nothing.
 */
function enableCleanup(): void {
  services.config.setConfig("cleanup_enabled", true);
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .onConflictDoNothing()
    .run();
  const now = Date.now();
  db.insert(jobRuns)
    .values({
      id: `sync-${now}`,
      jobId: "sync-media",
      status: "completed",
      log: "",
      progress: 1,
      message: "",
      startedAt: now,
      finishedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

const CLEANUP_RULE_CONFIG = { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } };

beforeEach(() => {
  db.delete(userPreferences).run();
  db.delete(cleanupCandidates).run();
  db.delete(mediaItems).run();
  db.delete(plexUserShares).run();
  db.delete(plexUsers).run();
  db.delete(rules).run();
  enableCleanup();

  seedUser(ALICE, "alice", [1]);
  seedUser(BOB, "bob", [2]);
});

describe("one user cannot read another's data", () => {
  test("preferences are the session's own, whatever the other user stored", async () => {
    const alice = callerFor(ALICE, "alice");
    const bob = callerFor(BOB, "bob");

    await alice.preferences.set({ preferences: { excludedCollections: ["Alice Only"] }, optedIn: true });
    await bob.preferences.set({ preferences: { excludedCollections: ["Bob Only"] }, optedIn: false });

    const forAlice = await alice.preferences.get();
    const forBob = await bob.preferences.get();

    assert.deepEqual(forAlice.preferences.excludedCollections, ["Alice Only"]);
    assert.equal(forAlice.optedIn, true);
    assert.deepEqual(forBob.preferences.excludedCollections, ["Bob Only"]);
    assert.equal(forBob.optedIn, false);
  });

  test("`me` reports the session, and takes no input to aim elsewhere", async () => {
    assert.deepEqual(await callerFor(ALICE, "alice").me(), { userId: ALICE, username: "alice" });
    assert.deepEqual(await callerFor(BOB, "bob").me(), { userId: BOB, username: "bob" });
  });

  test("a watch summary is scoped to the session's user", async () => {
    const alice = await callerFor(ALICE, "alice").myWatchSummary();
    const bob = await callerFor(BOB, "bob").myWatchSummary();
    // Nothing seeded, so both are empty — the point is that neither threw and
    // neither took a user id from the caller.
    assert.ok(alice);
    assert.ok(bob);
  });

  test("no portal procedure accepts a user id as input", async () => {
    // The structural version of everything above: if no procedure takes a
    // subject, none can be aimed. This is the tripwire for a procedure added
    // later with a `userId` parameter "just for the admin preview".
    const procedures = portalRouter._def.procedures as unknown as Record<string, { _def: { inputs: unknown[] } }>;

    const offenders: string[] = [];
    for (const [path, def] of Object.entries(procedures)) {
      for (const input of def._def.inputs) {
        const shape = (input as { def?: { shape?: Record<string, unknown> } })?.def?.shape;
        if (!shape) continue;
        for (const key of Object.keys(shape)) {
          if (/^(user_?id|username|account_?id)$/i.test(key)) offenders.push(`${path}.${key}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });
});

describe("library scoping", () => {
  test("search only returns titles from the user's shared libraries", async () => {
    seedMedia("m1", "Arrival", "1");
    seedMedia("m2", "Arrival Two", "2");

    const alice = await callerFor(ALICE, "alice").searchTitles({ q: "Arrival" });
    const bob = await callerFor(BOB, "bob").searchTitles({ q: "Arrival" });

    // The procedure returns bare titles, not rows.
    assert.deepEqual(alice, ["Arrival"]);
    assert.deepEqual(bob, ["Arrival Two"]);
  });

  test("a user shared nothing new sees nothing new", async () => {
    seedMedia("m1", "Arrival", "9");
    assert.deepEqual(await callerFor(ALICE, "alice").searchTitles({ q: "Arrival" }), []);
  });

  test("an empty share list means every library, not none", async () => {
    // The convention `plex_user_shares.sectionIds` already documents, and what
    // Plex means by an unfiltered share. Reading it as "nothing" makes the
    // portal look broken for the users most likely to be using it.
    db.delete(plexUserShares).run();
    db.insert(plexUserShares).values({ userId: ALICE, sectionIds: [], syncedAt: 0 }).run();
    seedMedia("m1", "Arrival", "1");
    seedMedia("m2", "Arrival Two", "9");

    const hits = await callerFor(ALICE, "alice").searchTitles({ q: "Arrival" });
    assert.equal(hits.length, 2);
  });

  test("no share row at all is likewise unrestricted", async () => {
    // The owner, and managed users Plex reports differently.
    db.delete(plexUserShares).run();
    seedMedia("m1", "Arrival", "1");
    seedMedia("m2", "Arrival Two", "9");

    const hits = await callerFor(ALICE, "alice").searchTitles({ q: "Arrival" });
    assert.equal(hits.length, 2);
  });

  test("leavingSoon is scoped to shared libraries too", async () => {
    // Being warned about a film leaving a library you cannot open is the exact
    // complaint `sharedSectionKeys` was added for.
    db.insert(rules)
      .values({ id: "r1", name: "Cleanup", type: "smart_filter", config: CLEANUP_RULE_CONFIG, createdAt: 0 })
      .run();
    for (const [ratingKey, sectionId] of [
      ["m1", "1"],
      ["m2", "2"],
    ]) {
      seedMedia(ratingKey!, `Film ${ratingKey}`, sectionId!);
      db.insert(cleanupCandidates)
        .values({
          ruleId: "r1",
          ratingKey: ratingKey!,
          sectionId: sectionId!,
          title: `Film ${ratingKey}`,
          streak: 3,
          firstMatchedAt: 0,
          lastMatchedAt: 0,
        })
        .run();
    }

    const alice = await callerFor(ALICE, "alice").leavingSoon();
    assert.deepEqual(
      alice.map((item) => item.ratingKey),
      ["m1"],
      "alice is warned about her own library, and not about one she cannot see",
    );
  });
});

describe("voteKeep", () => {
  test("refuses a rating key no rule has queued", async () => {
    // Without the check, a shared user could put named rows on the admin's
    // queue for items nothing had ever looked at — noise on the one page that
    // has to be trustworthy.
    await assert.rejects(() => callerFor(ALICE, "alice").voteKeep({ ratingKey: "not-queued", keep: true }), {
      code: "NOT_FOUND",
    });
  });

  test("accepts a vote on something actually queued, and can withdraw it", async () => {
    db.insert(rules).values({ id: "r1", name: "Cleanup", type: "cleanup", createdAt: 0 }).run();
    db.insert(cleanupCandidates)
      .values({
        ruleId: "r1",
        ratingKey: "m1",
        sectionId: "1",
        title: "Film",
        streak: 3,
        firstMatchedAt: 0,
        lastMatchedAt: 0,
      })
      .run();

    assert.deepEqual(await callerFor(ALICE, "alice").voteKeep({ ratingKey: "m1", keep: true }), { ok: true });
    // Withdrawing is not gated on the item still being queued — the row may
    // have been actioned since, and a vote you cannot remove is worse.
    assert.deepEqual(await callerFor(ALICE, "alice").voteKeep({ ratingKey: "m1", keep: false }), { ok: true });
  });
});

describe("input validation", () => {
  test("notInterested refuses an empty or oversized title", async () => {
    const alice = callerFor(ALICE, "alice");
    await assert.rejects(() => alice.notInterested({ title: "" }));
    await assert.rejects(() => alice.notInterested({ title: "   " }));
    await assert.rejects(() => alice.notInterested({ title: "x".repeat(501) }));
  });

  test("notInterested is idempotent", async () => {
    const alice = callerFor(ALICE, "alice");
    const first = await alice.notInterested({ title: "Sci-Fi Gems" });
    const second = await alice.notInterested({ title: "Sci-Fi Gems" });
    assert.equal(first.excluded, 1);
    assert.equal(second.excluded, 1, "pressing twice is one exclusion");
  });

  test("preferences.set refuses a malformed value rather than storing it", async () => {
    await assert.rejects(() =>
      callerFor(ALICE, "alice").preferences.set({
        preferences: { excludedCollections: "not-an-array" },
        optedIn: true,
      }),
    );
  });

  test("preferences.set merges rather than replacing", async () => {
    // The bug this router's docstring records: the form sends only the fields
    // it renders, so treating the payload as the whole state wiped everything
    // the other tab wrote.
    const alice = callerFor(ALICE, "alice");
    await alice.preferences.set({ preferences: { excludedCollections: ["Keep"] }, optedIn: true });
    await alice.preferences.set({ preferences: { excludedTitles: ["Also"] }, optedIn: true });

    const stored = await alice.preferences.get();
    assert.deepEqual(stored.preferences.excludedCollections, ["Keep"], "the earlier field survived");
    assert.deepEqual(stored.preferences.excludedTitles, ["Also"]);
  });

  test("an explicitly empty list still clears", async () => {
    // "Absent means unchanged" must not become "you can never clear a list".
    const alice = callerFor(ALICE, "alice");
    await alice.preferences.set({ preferences: { excludedCollections: ["Gone"] }, optedIn: true });
    await alice.preferences.set({ preferences: { excludedCollections: [] }, optedIn: true });

    assert.deepEqual((await alice.preferences.get()).preferences.excludedCollections, []);
  });
});
