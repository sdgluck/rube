import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createCheckpoint } from "./checkpoint.ts";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken } from "@tinkerbell/db";
import { jobCheckpoints, jobs } from "@tinkerbell/db";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { createCheckpoint: makeCheckpoint } = createCheckpoint(services);

const { eq } = await import("drizzle-orm");
const { CHECKPOINT_TTL_MS } = await import("./limits.ts");

const JOB_ID = "generate";

beforeEach(() => {
  db.delete(jobCheckpoints).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: JOB_ID, name: "Generate", command: "generate", schedule: "", enabled: 1, config: {} })
    .run();
});

describe("checkpoint", () => {
  it("round-trips arbitrary JSON state", () => {
    const cp = makeCheckpoint(JOB_ID);
    assert.equal(cp.read(), null);

    cp.write({ startedAt: 1, completedRuleIds: ["a", "b"] });
    assert.deepEqual(cp.read(), { startedAt: 1, completedRuleIds: ["a", "b"] });

    cp.write({ startedAt: 1, completedRuleIds: ["a", "b", "c"] });
    assert.deepEqual(cp.read(), { startedAt: 1, completedRuleIds: ["a", "b", "c"] });
  });

  it("clears on demand", () => {
    const cp = makeCheckpoint(JOB_ID);
    cp.write({ any: "thing" });
    cp.clear();
    assert.equal(cp.read(), null);
  });

  it("discards a checkpoint past its TTL", () => {
    // A stale checkpoint that still read as valid would let a run skip work it
    // never actually did — the one failure mode checkpointing must not have.
    const cp = makeCheckpoint(JOB_ID);
    cp.write({ completedRuleIds: ["a"] });
    db.update(jobCheckpoints)
      .set({ updatedAt: Date.now() - CHECKPOINT_TTL_MS - 1000 })
      .where(eq(jobCheckpoints.jobId, JOB_ID))
      .run();

    assert.equal(cp.read(), null);
    // …and the expired row is gone rather than being re-checked forever.
    assert.equal(db.select().from(jobCheckpoints).all().length, 0);
  });

  it("keeps a checkpoint just inside its TTL", () => {
    const cp = makeCheckpoint(JOB_ID);
    cp.write({ completedRuleIds: ["a"] });
    db.update(jobCheckpoints)
      .set({ updatedAt: Date.now() - CHECKPOINT_TTL_MS + 60_000 })
      .where(eq(jobCheckpoints.jobId, JOB_ID))
      .run();

    assert.deepEqual(cp.read(), { completedRuleIds: ["a"] });
  });

  it("keeps checkpoints separate per job", () => {
    db.insert(jobs)
      .values({ id: "sync-media", name: "Sync", command: "sync-media", schedule: "", enabled: 1, config: {} })
      .run();

    makeCheckpoint(JOB_ID).write({ which: "generate" });
    makeCheckpoint("sync-media").write({ which: "sync-media" });

    assert.deepEqual(makeCheckpoint(JOB_ID).read(), { which: "generate" });
    assert.deepEqual(makeCheckpoint("sync-media").read(), { which: "sync-media" });
  });

  it("never throws a run down when the write fails", () => {
    // A checkpoint is an optimisation. `no-such-job` violates the FK, which
    // must surface as a no-op rather than an exception out of ctx.checkpoint.
    const cp = makeCheckpoint("no-such-job");
    assert.doesNotThrow(() => cp.write({ a: 1 }));
    assert.equal(cp.read(), null);
  });
});
