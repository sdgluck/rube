import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { variantFor } from "@rube/contracts";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, jobRuns, jobs } from "@rube/db";
import { buildRunConfig } from "./run-config.ts";
import { createRunner } from "./runner.ts";

describe("buildRunConfig", () => {
  it("applies a variant's overrides over the stored config, without touching it", () => {
    const job = { id: "collections-sweep", config: { sections: ["Films"], dryRun: true } };
    const run = buildRunConfig(job, variantFor("collections-sweep", "delete"));
    assert.deepEqual(run, { sections: ["Films"], dryRun: false });
    assert.equal(job.config.dryRun, true);
  });

  it("lets a job's locked keys win over any variant", () => {
    const remove = buildRunConfig({ id: "overlays-remove", config: { mode: "apply" } });
    assert.equal(remove.mode, "remove");
  });
});

describe("startJob with a variant", () => {
  const c = createTestContainer();
  after(() => c.dispose());
  const db = c.resolve(DbToken);
  const { startJob } = createRunner(c.resolve(ServicesToken));

  function seed(id: string, command: string): void {
    db.insert(jobs).values({ id, name: id, command, schedule: "", enabled: 1, config: {} }).run();
  }
  const runsOf = (id: string) => db.select().from(jobRuns).where(eq(jobRuns.jobId, id)).all();

  it("refuses a variant the command doesn't have, leaving no run behind", async () => {
    seed("sweep", "collections-sweep");
    assert.deepEqual(await startJob("sweep", { variant: "nope" }), { ok: false, reason: "unknown-variant" });
    assert.equal(runsOf("sweep").length, 0);
  });

  it("refuses any variant of an in-process job", async () => {
    seed("purge", "purge-runs");
    assert.deepEqual(await startJob("purge", { variant: "preview" }), { ok: false, reason: "unknown-variant" });
    assert.equal(runsOf("purge").length, 0);
  });
});
