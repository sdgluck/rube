/**
 * The schedule save, through the router: which failures the page can show
 * next to what caused them (400), which mean "reload" (409), and onboarding's
 * "Use recommended" moving only the jobs nobody has touched.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { initTRPC, TRPCError } from "@trpc/server";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, jobs } from "@rube/db";
import { JobsToken, registerJobs } from "@rube/jobs";
import { createTrpc } from "./index.ts";
import type { AdminContext } from "./_base.ts";

const c = createTestContainer({ overrides: registerJobs });
const jobsService = c.resolve(JobsToken);
after(() => {
  // Saves start live crons; a disabled re-schedule stops each one so the
  // process can exit.
  for (const j of jobsService.scheduleContext().jobs) {
    jobsService.scheduleCron({ id: j.id, name: j.name, schedule: j.schedule, enabled: 0 });
  }
  c.dispose();
});

const db = c.resolve(DbToken);
const { appRouter } = createTrpc({ ...c.resolve(ServicesToken), jobs: jobsService });

function caller() {
  const ctx = {
    session: undefined,
    resHeaders: new Headers(),
    secure: false,
    origin: "http://admin.rube.test",
    ip: "test",
    authRequired: false,
  } as unknown as AdminContext;
  return initTRPC.context<AdminContext>().create().createCallerFactory(appRouter)(ctx);
}

function scheduleOf(id: string): string {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!.schedule;
}

async function rejectsWith(promise: Promise<unknown>, code: TRPCError["code"]) {
  await assert.rejects(promise, (err: unknown) => err instanceof TRPCError && err.code === code);
}

beforeEach(() => {
  db.delete(jobs).run();
  jobsService.seedDefaultJobs();
});

describe("jobs.updateSchedules", () => {
  test("a blocking problem is a 400", async () => {
    await rejectsWith(
      caller().jobs.updateSchedules({
        jobs: [{ jobId: "cleanup", schedule: "not a cron", expected: { schedule: "0 4 * * *", enabled: true } }],
      }),
      "BAD_REQUEST",
    );
  });

  test("saving over somebody else's edit is a 409", async () => {
    await rejectsWith(
      caller().jobs.updateSchedules({
        jobs: [{ jobId: "cleanup", schedule: "0 5 * * *", expected: { schedule: "0 3 * * *", enabled: true } }],
      }),
      "CONFLICT",
    );
    assert.equal(scheduleOf("cleanup"), "0 4 * * *");
  });

  test("a valid save returns the warnings that remain", async () => {
    const result = await caller().jobs.updateSchedules({
      jobs: [{ jobId: "cleanup", schedule: "30 4 * * *", expected: { schedule: "0 4 * * *", enabled: true } }],
    });
    assert.equal(scheduleOf("cleanup"), "30 4 * * *");
    assert.ok(Array.isArray(result.issues));
  });
});

describe("onboarding.applyScheduleDefaults", () => {
  test("moves the shipped schedule into the window, but not a job the user moved", async () => {
    db.update(jobs).set({ schedule: "45 4 * * *" }).where(eq(jobs.id, "cleanup")).run();
    const result = await caller().onboarding.applyScheduleDefaults({ timezone: "UTC" });
    assert.ok(result.moved.includes("sync-media"));
    assert.equal(scheduleOf("sync-media"), "0 1 * * *");
    assert.equal(scheduleOf("cleanup"), "45 4 * * *");
  });
});
