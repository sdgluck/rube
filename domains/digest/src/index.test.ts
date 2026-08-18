/**
 * `buildDigest` is pure and DB-only, so the interesting half is testable
 * against a seeded database with no network at all — which is the property
 * that made it worth writing that way.
 *
 * The boundary cases carry most of the weight here. `media_items.addedAt` is
 * in Plex's seconds while every other timestamp is milliseconds, and a period
 * is half-open, so "an item added exactly on the boundary appears once" is the
 * assertion that catches both mistakes at the same time.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-digest-test-");

const {
  db,
  cleanupCandidates,
  collections,
  digestDeliveries,
  jobs,
  jobRuns,
  mediaItems,
  playbackSessions,
  rules,
  watchState,
} = await import("@tinkerbell/db");
const { buildDigest, isDigestEmpty, tailor } = await import("./build.ts");
const { claimDelivery, completeDelivery, lastSentAt, releaseDelivery } = await import("./deliveries.ts");
const { periodFor, startOfDay } = await import("./period.ts");
const { renderDigest } = await import("./render.ts");
const { defaultUserPreferences, setConfig, userPreferencesSchema } = await import("@tinkerbell/core");

/**
 * An install where cleanup could actually remove something: the switch on, and a
 * recent successful library sync. The digest's leaving-soon list asks the cleanup
 * domain the same question the engine does, so a default install — where cleanup
 * is off — correctly has nothing to announce.
 */
function enableCleanup(): void {
  setConfig("cleanup_enabled", true);
  db.insert(jobs)
    .values({ id: "sync-media", name: "Sync Media", command: "sync-media", schedule: "", enabled: 1, config: {} })
    .onConflictDoNothing()
    .run();
  db.insert(jobRuns)
    .values({
      id: "sync-now",
      jobId: "sync-media",
      status: "completed",
      log: "",
      progress: 1,
      message: "",
      startedAt: Date.now(),
      finishedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

const DAY = 86_400_000;
/** 2023-11-14T22:13:20Z — deliberately not midnight, so alignment is tested. */
const NOW = 1_700_000_000_000;
const SINCE = NOW - 7 * DAY;
const UNTIL = NOW;

const USER = 7;
const OTHER_USER = 8;

function addItem(
  ratingKey: string,
  opts: {
    addedAtMs?: number;
    title?: string;
    year?: number | null;
    type?: string;
    genres?: string[] | null;
    rating?: number | null;
    durationMs?: number | null;
  } = {},
) {
  db.insert(mediaItems)
    .values({
      ratingKey,
      sectionId: "1",
      sectionTitle: "Movies",
      title: opts.title ?? `Film ${ratingKey}`,
      year: opts.year ?? 2020,
      type: opts.type ?? "movie",
      // Stored in Plex's seconds, which is the whole point of the conversion
      // under test.
      addedAt: Math.floor((opts.addedAtMs ?? NOW - DAY) / 1000),
      genres: opts.genres ?? null,
      rating: opts.rating ?? null,
      durationMs: opts.durationMs ?? null,
      syncedAt: NOW,
    })
    .run();
}

function addPlay(
  id: string,
  opts: { userId?: number; startedAt?: number; watchedMs?: number; title?: string; ratingKey?: string } = {},
) {
  db.insert(playbackSessions)
    .values({
      id,
      userId: opts.userId ?? USER,
      username: "sam",
      ratingKey: opts.ratingKey ?? "100",
      title: opts.title ?? "Something",
      type: "movie",
      startedAt: opts.startedAt ?? NOW - 2 * DAY,
      lastSeenAt: opts.startedAt ?? NOW - 2 * DAY,
      watchedMs: opts.watchedMs ?? 3_600_000,
    })
    .run();
}

beforeEach(() => {
  db.delete(mediaItems).run();
  db.delete(playbackSessions).run();
  db.delete(collections).run();
  db.delete(cleanupCandidates).run();
  db.delete(digestDeliveries).run();
  db.delete(watchState).run();
  db.delete(rules).run();
  db.delete(jobRuns).run();
  db.delete(jobs).run();
});

// ─── Period boundaries ───────────────────────────────────────────────────────

describe("period boundaries", () => {
  test("an item added exactly at `since` is included", () => {
    addItem("100", { addedAtMs: SINCE });
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.deepEqual(
      digest.added.map((i) => i.ratingKey),
      ["100"],
    );
  });

  test("an item added exactly at `until` is excluded — the window is half-open", () => {
    addItem("100", { addedAtMs: UNTIL });
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.deepEqual(digest.added, []);
  });

  test("an item on the boundary appears in exactly one of two adjacent periods", () => {
    addItem("100", { addedAtMs: SINCE });

    const earlier = buildDigest({ since: SINCE - 7 * DAY, until: SINCE });
    const later = buildDigest({ since: SINCE, until: UNTIL });

    assert.equal(earlier.added.length + later.added.length, 1, "counted twice, or not at all");
    assert.equal(later.added.length, 1, "should land in the period that starts on it");
  });

  test("addedAt is read as Plex seconds, not milliseconds", () => {
    // Stored as seconds. Read as milliseconds it would be ~1970 and fall
    // outside every period we ask about.
    addItem("100", { addedAtMs: NOW - DAY });
    assert.equal(buildDigest({ since: SINCE, until: UNTIL }).added.length, 1);
  });

  test("plays are bounded the same way", () => {
    addPlay("a", { startedAt: SINCE });
    addPlay("b", { startedAt: UNTIL });
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(digest.watched.length, 1);
  });
});

describe("periodFor", () => {
  test("two runs on the same day produce the same period", () => {
    // The idempotency guarantee rests on this: the ledger is keyed on
    // `periodStart`, so a rolling "now minus 7 days" would let a second run
    // the same day claim a fresh row and send a second digest.
    const dayStart = startOfDay(NOW);
    const morning = periodFor("weekly", dayStart + 9 * 3_600_000);
    const evening = periodFor("weekly", dayStart + 21 * 3_600_000);

    assert.equal(morning.since, evening.since);
    assert.equal(morning.until, evening.until);
    assert.equal(morning.until, dayStart);
  });

  test("the next day's run moves the window on", () => {
    const today = periodFor("weekly", NOW);
    const tomorrow = periodFor("weekly", NOW + DAY);
    assert.equal(tomorrow.since - today.since, DAY);
  });

  test("weekly covers 7 days, monthly 30", () => {
    assert.equal(periodFor("weekly", NOW).until - periodFor("weekly", NOW).since, 7 * DAY);
    assert.equal(periodFor("monthly", NOW).until - periodFor("monthly", NOW).since, 30 * DAY);
  });

  test("the period ends at midnight rather than at `now`", () => {
    assert.ok(periodFor("weekly", NOW).until <= NOW, "must not report on a day that hasn't finished");
  });
});

// ─── Server-wide content ─────────────────────────────────────────────────────

describe("server-wide digest", () => {
  test("episodes are left out of `added` — a season drop is one thing, not ten", () => {
    addItem("100", { type: "movie" });
    addItem("101", { type: "episode" });
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.deepEqual(
      digest.added.map((i) => i.ratingKey),
      ["100"],
    );
  });

  test("stats count hours watched and distinct viewers", () => {
    addPlay("a", { userId: USER, watchedMs: 3_600_000 });
    addPlay("b", { userId: OTHER_USER, watchedMs: 1_800_000 });
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(digest.stats.hoursWatched, 1.5);
    assert.equal(digest.stats.activeUsers, 2);
  });

  test("a binged show collapses to one row rather than one per episode", () => {
    for (let i = 0; i < 4; i++) {
      db.insert(playbackSessions)
        .values({
          id: `ep${i}`,
          userId: USER,
          username: "sam",
          ratingKey: `20${i}`,
          title: `Episode ${i}`,
          grandparentTitle: "The Show",
          type: "episode",
          startedAt: NOW - 2 * DAY,
          lastSeenAt: NOW - 2 * DAY,
          watchedMs: 1_200_000,
        })
        .run();
    }
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(digest.watched.length, 1);
    assert.equal(digest.watched[0].title, "The Show");
    assert.equal(digest.watched[0].plays, 4);
  });
});

// ─── Per-user tailoring ──────────────────────────────────────────────────────

function prefs(overrides: Record<string, unknown> = {}) {
  return userPreferencesSchema.parse({ ...defaultUserPreferences(), ...overrides });
}

describe("tailoring", () => {
  test("hated genres are excluded when strictHate is on", () => {
    addItem("100", { genres: ["Horror"] });
    addItem("101", { genres: ["Comedy"] });

    const digest = buildDigest({
      since: SINCE,
      until: UNTIL,
      userId: USER,
      preferences: prefs({ genres: { loved: [], liked: [], hated: ["Horror"] }, strictHate: true }),
    });

    assert.deepEqual(
      digest.added.map((i) => i.ratingKey),
      ["101"],
    );
  });

  test("with strictHate off, a hated genre is demoted rather than dropped", () => {
    addItem("100", { genres: ["Horror"], title: "Hated" });
    addItem("101", { genres: ["Comedy"], title: "Fine" });

    const digest = buildDigest({
      since: SINCE,
      until: UNTIL,
      userId: USER,
      preferences: prefs({ genres: { loved: [], liked: [], hated: ["Horror"] }, strictHate: false }),
    });

    assert.equal(digest.added.length, 2);
    assert.equal(digest.added[0].title, "Fine", "the hated one should rank last, not vanish");
  });

  test("the rating floor excludes rated items below it", () => {
    addItem("100", { rating: 4 });
    addItem("101", { rating: 8 });

    const digest = buildDigest({ since: SINCE, until: UNTIL, userId: USER, preferences: prefs({ ratingFloor: 7 }) });

    assert.deepEqual(
      digest.added.map((i) => i.ratingKey),
      ["101"],
    );
  });

  test("an unrated item is not excluded by a rating floor", () => {
    // Unknown metadata must never exclude: a brand-new item Plex hasn't
    // scanned yet is exactly what a digest is for.
    addItem("100", { rating: null });
    const digest = buildDigest({ since: SINCE, until: UNTIL, userId: USER, preferences: prefs({ ratingFloor: 7 }) });
    assert.equal(digest.added.length, 1);
  });

  test("excluded titles are dropped, case-insensitively", () => {
    addItem("100", { title: "Cats" });
    addItem("101", { title: "Dogs" });

    const digest = buildDigest({
      since: SINCE,
      until: UNTIL,
      userId: USER,
      preferences: prefs({ excludedTitles: ["cats"] }),
    });

    assert.deepEqual(
      digest.added.map((i) => i.title),
      ["Dogs"],
    );
  });

  test("loved genres rank ahead of the rest", () => {
    addItem("100", { title: "Meh", genres: ["Drama"] });
    addItem("101", { title: "Loved", genres: ["Sci-Fi"] });

    const digest = buildDigest({
      since: SINCE,
      until: UNTIL,
      userId: USER,
      preferences: prefs({ genres: { loved: ["Sci-Fi"], liked: [], hated: [] } }),
    });

    assert.equal(digest.added[0].title, "Loved");
  });

  test("new_to_me hides what this user has already played, and only this user", () => {
    addItem("100", { title: "Seen" });
    addItem("101", { title: "Unseen" });
    db.insert(watchState).values({ ratingKey: "100", userId: USER, plays: 1 }).run();
    db.insert(watchState).values({ ratingKey: "101", userId: OTHER_USER, plays: 1 }).run();

    const digest = buildDigest({
      since: SINCE,
      until: UNTIL,
      userId: USER,
      preferences: prefs({ watchedBias: "new_to_me" }),
    });

    assert.deepEqual(
      digest.added.map((i) => i.title),
      ["Unseen"],
    );
  });

  test("the list is capped", () => {
    for (let i = 0; i < 20; i++) addItem(`1${i}`);
    const digest = buildDigest({ since: SINCE, until: UNTIL, userId: USER, preferences: prefs(), userItemCap: 5 });
    assert.equal(digest.added.length, 5);
  });

  test("tailor never excludes on metadata it doesn't have", () => {
    const items = [{ ratingKey: "missing", title: "Unknown", year: null, type: "movie", sectionTitle: "Movies" }];
    const kept = tailor(items, prefs({ ratingFloor: 9, runtime: { maxMinutes: 5 } }), USER, 5);
    assert.equal(kept.length, 1);
  });
});

// ─── Emptiness ───────────────────────────────────────────────────────────────

describe("isDigestEmpty", () => {
  test("a period with nothing added is empty", () => {
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(isDigestEmpty(digest, 1), true);
  });

  test("a period below the minimum is empty", () => {
    addItem("100");
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(isDigestEmpty(digest, 5), true);
    assert.equal(isDigestEmpty(digest, 1), false);
  });

  test("something about to be deleted is worth sending on its own", () => {
    enableCleanup();
    db.insert(rules)
      .values({
        id: "r1",
        name: "Old films",
        type: "smart_filter",
        config: { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } },
        createdAt: NOW,
      })
      .run();
    db.insert(cleanupCandidates)
      .values({
        ruleId: "r1",
        ratingKey: "500",
        sectionId: "1",
        title: "Doomed",
        streak: 3,
        firstMatchedAt: NOW - 3 * DAY,
        lastMatchedAt: NOW,
      })
      .run();

    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.equal(digest.leavingSoon.length, 1);
    assert.equal(isDigestEmpty(digest, 1), false);
  });
});

// ─── The ledger ──────────────────────────────────────────────────────────────

describe("delivery ledger", () => {
  const key = { periodStart: SINCE, periodEnd: UNTIL, userId: USER, channel: "email" };

  test("a second claim for the same period, user and channel is refused", () => {
    assert.equal(claimDelivery(key), true);
    assert.equal(claimDelivery(key), false, "a re-run must not send again");
  });

  test("the same period on a different channel is a separate delivery", () => {
    assert.equal(claimDelivery(key), true);
    assert.equal(claimDelivery({ ...key, channel: "discord" }), true);
  });

  test("the next period claims afresh", () => {
    assert.equal(claimDelivery(key), true);
    assert.equal(claimDelivery({ ...key, periodStart: SINCE + 7 * DAY, periodEnd: UNTIL + 7 * DAY }), true);
  });

  test("a released claim can be retried", () => {
    assert.equal(claimDelivery(key), true);
    releaseDelivery(key);
    assert.equal(claimDelivery(key), true);
  });

  test("one recipient's failure is recorded without blocking the others", () => {
    claimDelivery(key);
    completeDelivery(key, { status: "failed", error: "connection refused" });

    const other = { ...key, userId: OTHER_USER };
    assert.equal(claimDelivery(other), true, "a failure for one user must not claim another's slot");
    completeDelivery(other, { status: "sent", itemCount: 3 });

    const rows = db.select().from(digestDeliveries).all();
    const failed = rows.find((r) => r.userId === USER);
    const sent = rows.find((r) => r.userId === OTHER_USER);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, "connection refused");
    assert.equal(sent?.status, "sent");
    assert.equal(sent?.itemCount, 3);
  });

  test("an empty digest is recorded as skipped rather than sent", () => {
    claimDelivery(key);
    completeDelivery(key, { status: "skipped_empty" });
    assert.equal(db.select().from(digestDeliveries).all()[0].status, "skipped_empty");
  });

  test("a period skipped as empty can still send once something turns up", () => {
    // Nothing was sent for it, so re-claiming can't duplicate anything —
    // whereas refusing means a job that runs daily with a weekly window
    // records "nothing happened" on Monday and never sends that week.
    claimDelivery(key);
    completeDelivery(key, { status: "skipped_empty" });

    assert.equal(claimDelivery(key), true);
    completeDelivery(key, { status: "sent", itemCount: 2 });

    const rows = db.select().from(digestDeliveries).all();
    assert.equal(rows.length, 1, "re-claiming must reuse the row, not add a second");
    assert.equal(rows[0].status, "sent");
  });

  test("a failed delivery is not retried for the rest of the period", () => {
    // It reached the network. Retrying every run until the period rolls is how
    // a half-working channel turns into a stream of duplicates.
    claimDelivery(key);
    completeDelivery(key, { status: "failed", error: "550 rejected" });
    assert.equal(claimDelivery(key), false);
  });

  test("a sent delivery is never re-claimed", () => {
    claimDelivery(key);
    completeDelivery(key, { status: "sent", itemCount: 1 });
    assert.equal(claimDelivery(key), false, "the whole point of the ledger");
  });

  test("lastSentAt ignores skipped and failed rows", () => {
    claimDelivery(key);
    completeDelivery(key, { status: "skipped_empty" });
    assert.equal(lastSentAt(USER, SINCE), null, "a skipped week must not delay the next digest");

    const next = { ...key, periodStart: SINCE + 7 * DAY };
    claimDelivery(next);
    completeDelivery(next, { status: "sent", itemCount: 1 });
    assert.notEqual(lastSentAt(USER, SINCE), null);
  });
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("rendering", () => {
  test("a rendered digest always carries plain text for services that can't do better", () => {
    addItem("100", { title: "A Film" });
    const message = renderDigest(buildDigest({ since: SINCE, until: UNTIL }));

    assert.ok(message.title.length > 0);
    assert.ok(message.text.length > 0, "text is the whole message on Gotify/Pushover, not a summary");
    assert.ok(message.blocks && message.blocks.length > 0);
  });

  test("no item yields an image URL, so nothing renders a broken one", () => {
    addItem("100");
    const digest = buildDigest({ since: SINCE, until: UNTIL });
    assert.ok(
      [...digest.added, ...digest.watched, ...digest.leavingSoon].every((i) => i.imageUrl === undefined),
      "an item with no public poster source must yield no image rather than a broken URL",
    );
    assert.equal(renderDigest(digest).imageUrl, undefined);
  });

  test("a user's digest is addressed to them", () => {
    addItem("100");
    const digest = buildDigest({ since: SINCE, until: UNTIL, userId: USER, preferences: prefs() });
    const message = renderDigest(digest, { username: "sam" });
    assert.match(message.text, /^sam, here's/);
  });

  test("the structured payload carries the digest for webhook consumers", () => {
    addItem("100");
    const message = renderDigest(buildDigest({ since: SINCE, until: UNTIL }));
    assert.equal((message.data as { stats: { itemsAdded: number } }).stats.itemsAdded, 1);
  });
});
