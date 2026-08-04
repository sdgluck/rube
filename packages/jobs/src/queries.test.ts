import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "./test-support/temp-db.ts";

setupTempDb();

const { db, jobs, jobRuns } = await import("@tinkerbell/db");
const { getJobRun, getJobRunLog, getJobRunFullLog, getActiveRuns, getRecentRuns } = await import("./queries.ts");

const JOB_ID = "test-job";

function insertRun(id: string, status: string, log = "", startedAt = Date.now()): void {
  db.insert(jobRuns).values({ id, jobId: JOB_ID, status, log, progress: 0, message: "", startedAt }).run();
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
  db.insert(jobs)
    .values({ id: JOB_ID, name: "Test Job", command: "shuffle", schedule: "", enabled: 1, config: {} })
    .run();
});

describe("getJobRun", () => {
  it("omits the log", () => {
    // The UI polls this once a second while a run is live. Shipping a
    // multi-megabyte log with every poll was the most expensive thing the API
    // did, so the log has its own incremental endpoint.
    insertRun("r1", "running", "lots of output");
    const run = getJobRun("r1");
    assert.ok(run);
    assert.equal("log" in run, false);
    assert.equal(run.status, "running");
  });

  it("returns null for a missing run", () => {
    assert.equal(getJobRun("nope"), null);
  });
});

describe("getJobRunLog", () => {
  it("stitches offsets back into the full log", () => {
    const full = "alpha\nbravo\ncharlie\ndelta\n";
    insertRun("r1", "completed", full);

    let offset = 0;
    let assembled = "";
    // Walk it in small bites, exactly as the UI hook does.
    for (let i = 0; i < 20 && offset < full.length; i++) {
      const slice = getJobRunLog("r1", offset);
      assert.ok(slice);
      assembled += slice.chunk;
      offset = slice.nextOffset;
      assert.equal(slice.size, full.length);
    }
    assert.equal(assembled, full);
  });

  it("returns only what was appended since the caller's offset", () => {
    insertRun("r1", "running", "first\n");
    const first = getJobRunLog("r1", 0);
    assert.equal(first?.chunk, "first\n");

    db.update(jobRuns).set({ log: "first\nsecond\n" }).run();

    const second = getJobRunLog("r1", first!.nextOffset);
    assert.equal(second?.chunk, "second\n");
    assert.equal(second?.nextOffset, "first\nsecond\n".length);
  });

  it("reports an empty chunk once the caller is caught up", () => {
    insertRun("r1", "completed", "done\n");
    const slice = getJobRunLog("r1", "done\n".length);
    assert.equal(slice?.chunk, "");
    assert.equal(slice?.size, "done\n".length);
  });

  it("clamps a negative or fractional offset", () => {
    insertRun("r1", "completed", "abc");
    assert.equal(getJobRunLog("r1", -5)?.chunk, "abc");
    assert.equal(getJobRunLog("r1", 1.7)?.chunk, "bc");
  });

  it("returns null for a missing run", () => {
    assert.equal(getJobRunLog("nope", 0), null);
  });
});

describe("getJobRunFullLog", () => {
  it("returns the whole log for the download affordance", () => {
    insertRun("r1", "completed", "everything\n");
    assert.equal(getJobRunFullLog("r1"), "everything\n");
    assert.equal(getJobRunFullLog("nope"), null);
  });
});

describe("getActiveRuns", () => {
  it("includes `cancelling` runs", () => {
    // A cancelling run is still executing and still occupies its job — it
    // should not vanish from the UI and reappear in the recent list.
    insertRun("running", "running");
    insertRun("cancelling", "cancelling");
    insertRun("done", "completed");

    const ids = getActiveRuns().map((r) => r.id);
    assert.deepEqual(ids.sort(), ["cancelling", "running"]);
  });
});

describe("getRecentRuns", () => {
  it("defaults to 8 and honours an explicit limit", () => {
    for (let i = 0; i < 12; i++) insertRun(`r${i}`, "completed", "", Date.now() - i * 1000);
    assert.equal(getRecentRuns().length, 8);
    assert.equal(getRecentRuns(3).length, 3);
    assert.equal(getRecentRuns(50).length, 12);
  });
});
