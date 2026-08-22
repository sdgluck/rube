/**
 * The stress-test config and step shapes exist in two places: the zod schemas
 * here, which are the authority, and the `$type<>` annotations on the JSON
 * columns in `packages/db/src/schema.ts`. They are duplicated because `db` sits
 * below `jobs` in the layering and cannot import it.
 *
 * Duplication that nothing checks is duplication that drifts, so the
 * assignability assertions below fail the typecheck the moment the two
 * disagree — which is the only enforcement available across that boundary.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stressTestRuns } from "@tinkerbell/db";

import {
  stressTestConfigInputSchema,
  stressTestConfigSchema,
  stressTestStepSchema,
  type StressTestConfig,
  type StressTestStep,
} from "./index.ts";
import { stressTestSampleSchema, type StressTestSample } from "./telemetry.ts";

// `$inferSelect`, not `$inferInsert` — the insert type is widened with drizzle's
// `SQL` escape hatch, which would make the comparison meaningless.
type DbConfig = (typeof stressTestRuns.$inferSelect)["config"];
type DbStep = (typeof stressTestRuns.$inferSelect)["steps"][number];
type DbSample = (typeof stressTestRuns.$inferSelect)["telemetry"][number];

// Both directions: a value the zod schema produces must be storable, and a
// value read out of the column must satisfy the schema's type.
const _configToDb: DbConfig = {} as StressTestConfig;
const _dbToConfig: StressTestConfig = {} as DbConfig;
const _stepToDb: DbStep = {} as StressTestStep;
const _dbToStep: StressTestStep = {} as DbStep;
const _sampleToDb: DbSample = {} as StressTestSample;
const _dbToSample: StressTestSample = {} as DbSample;
void _configToDb;
void _dbToConfig;
void _stepToDb;
void _dbToStep;
void _sampleToDb;
void _dbToSample;

describe("stored schemas", () => {
  it("parses a row written before the later fields existed", () => {
    // Old rows have no `sessionsSeen`/`streamErrors`/`reason`. Reading history
    // must not throw over columns that did not exist when it was written.
    const legacy = { step: 1, sessions: 1, avgTranscodeSpeed: 2.5, avgBandwidth: 900, errors: 0, timestamp: 1 };
    assert.deepEqual(stressTestStepSchema.parse(legacy), legacy);
  });

  it("parses a step row written before the telemetry fields existed", () => {
    // `totalKbps` and friends arrived with the time series. A run recorded
    // before it must still open, showing what it did record.
    const legacy = {
      step: 3,
      sessions: 3,
      avgTranscodeSpeed: 1.4,
      avgBandwidth: 4200,
      errors: 0,
      timestamp: 1,
      sessionsSeen: 3,
      streamErrors: 0,
    };
    assert.deepEqual(stressTestStepSchema.parse(legacy), legacy);
  });

  it("rejects a sample missing a field the chart draws", () => {
    // The series is only useful if every point carries every line. A partial
    // sample would render as a gap that looks like a stall.
    assert.equal(stressTestSampleSchema.safeParse({ t: 0, step: 1, phase: "measure" }).success, false);
  });

  it("accepts a sample with no sessions visible", () => {
    // Zero sessions seen is a reading, not an absence of one — it is what a
    // server reaping streams under load looks like from outside.
    const sample = {
      t: 1200,
      step: 4,
      phase: "settle" as const,
      started: 4,
      seen: 0,
      speed: null,
      speedMin: null,
      kbps: 0,
      actualKbps: 0,
      ok: 0,
      err: 2,
      notReady: 0,
      apiError: false,
      sessions: [],
    };
    assert.deepEqual(stressTestSampleSchema.parse(sample), sample);
  });

  it("accepts a stored config without bounds", () => {
    // The read schema is deliberately unbounded: a row recorded when the cap
    // was different is still history, and must not fail the listing.
    assert.equal(stressTestConfigSchema.parse({ mode: "transcode", maxSessions: 500 }).maxSessions, 500);
  });
});

describe("the API input schema", () => {
  it("accepts a normal request", () => {
    assert.equal(stressTestConfigInputSchema.parse({ mode: "mixed", transcodePct: 50, maxSessions: 20 }).mode, "mixed");
  });

  it("defaults are allowed to be absent", () => {
    assert.deepEqual(stressTestConfigInputSchema.parse({ mode: "transcode" }), { mode: "transcode" });
  });

  it("rejects a session count that would flatten the user's server", () => {
    // The router used to restate this inline as a bare `z.number()`, so the
    // UI's 1–50 was the only bound anywhere.
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "transcode", maxSessions: 100_000 }).success, false);
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "transcode", maxSessions: 0 }).success, false);
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "transcode", maxSessions: 2.5 }).success, false);
  });

  it("rejects a transcode share that is not a percentage", () => {
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "mixed", transcodePct: 101 }).success, false);
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "mixed", transcodePct: -1 }).success, false);
  });

  it("rejects an unknown mode", () => {
    assert.equal(stressTestConfigInputSchema.safeParse({ mode: "warp-speed" }).success, false);
  });
});
