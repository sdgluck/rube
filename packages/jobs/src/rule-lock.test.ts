/**
 * The rule lock exists for one failure: two runs of the same rule overlapping,
 * both passing the delete-old-collections step before either creates, and both
 * creations surviving as duplicates in Plex. The runs that race live in
 * different execution contexts (worker thread vs API process), so these tests
 * care about the parts an in-process Map couldn't give us — mutual exclusion
 * through the database, and a lease that outlives a holder that never released.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { db, ruleLocks } = await import("@tinkerbell/db");
const {
  acquireRuleLock,
  renewRuleLock,
  releaseRuleLock,
  getRuleLock,
  withRuleLock,
  RuleLockedError,
  RULE_LOCK_LEASE_MS,
} = await import("@tinkerbell/domain.rules");

const RULE = "rule-1";

describe("rule lock", () => {
  beforeEach(() => {
    db.delete(ruleLocks).run();
  });

  it("lets exactly one holder in", () => {
    const first = acquireRuleLock(RULE, "the Generate Collections job");
    const second = acquireRuleLock(RULE, "a manual run");

    assert.ok(first);
    assert.equal(second, null);
  });

  it("locks per rule, not globally — unrelated rules run concurrently", () => {
    assert.ok(acquireRuleLock(RULE, "a"));
    assert.ok(acquireRuleLock("rule-2", "b"));
  });

  it("frees the rule on release", () => {
    const handle = acquireRuleLock(RULE, "a")!;
    releaseRuleLock(handle);

    assert.equal(getRuleLock(RULE), null);
    assert.ok(acquireRuleLock(RULE, "b"));
  });

  it("hands the lock to the next caller once the lease lapses", () => {
    const start = 1_000_000;
    const abandoned = acquireRuleLock(RULE, "a killed worker", start);
    assert.ok(abandoned);

    // Still held right up to the expiry instant...
    assert.equal(acquireRuleLock(RULE, "b", start + RULE_LOCK_LEASE_MS - 1), null);
    // ...and free once it passes. Without this a worker thread killed with its
    // process would wedge the rule permanently.
    assert.ok(acquireRuleLock(RULE, "b", start + RULE_LOCK_LEASE_MS));
  });

  it("renews the lease, so a slow run doesn't lose its lock", () => {
    const start = 1_000_000;
    const handle = acquireRuleLock(RULE, "a", start)!;

    assert.equal(renewRuleLock(handle, start + RULE_LOCK_LEASE_MS / 2), true);
    // The renewal moved expiry past the original lease.
    assert.equal(acquireRuleLock(RULE, "b", start + RULE_LOCK_LEASE_MS), null);
  });

  it("refuses to renew or release a lock that was taken over", () => {
    const start = 1_000_000;
    const stale = acquireRuleLock(RULE, "a", start)!;
    const fresh = acquireRuleLock(RULE, "b", start + RULE_LOCK_LEASE_MS)!;

    assert.equal(renewRuleLock(stale, start + RULE_LOCK_LEASE_MS + 1), false);
    releaseRuleLock(stale);

    // The new holder still holds it — the stale release was a no-op.
    assert.equal(getRuleLock(RULE, start + RULE_LOCK_LEASE_MS + 1)?.holder, fresh.holder);
  });

  it("reports the holder's label, so the loser can say who has it", () => {
    acquireRuleLock(RULE, "the Generate Collections job");
    assert.equal(getRuleLock(RULE)?.holderLabel, "the Generate Collections job");
  });
});

describe("withRuleLock", () => {
  beforeEach(() => {
    db.delete(ruleLocks).run();
  });

  it("releases the lock when the body throws", async () => {
    await assert.rejects(
      withRuleLock(RULE, "a", async () => {
        throw new Error("handler blew up");
      }),
      /handler blew up/,
    );

    assert.equal(getRuleLock(RULE), null);
  });

  it("serialises overlapping bodies rather than interleaving them", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstStarted = Promise.withResolvers<void>();

    const first = withRuleLock(RULE, "first", async () => {
      order.push("first:start");
      firstStarted.resolve();
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      order.push("first:end");
    });

    await firstStarted.promise;
    const second = withRuleLock(RULE, "second", async () => order.push("second:start"), { waitMs: 5_000 });

    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
  });

  it("throws RuleLockedError naming the holder when it can't wait", async () => {
    const handle = acquireRuleLock(RULE, "the Generate Collections job")!;
    try {
      await assert.rejects(
        withRuleLock(RULE, "a manual run", async () => "never runs"),
        (err: unknown) => {
          assert.ok(err instanceof RuleLockedError);
          assert.equal(err.heldBy, "the Generate Collections job");
          assert.match(err.message, /already being run by the Generate Collections job/);
          return true;
        },
      );
    } finally {
      releaseRuleLock(handle);
    }
  });
});
