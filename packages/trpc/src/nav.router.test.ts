/**
 * The Jobs dot in the sidebar, which used to be a healthcheck dot: a poster
 * refresh that failed four days earlier left it green the whole time.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { initTRPC } from "@trpc/server";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DAY_MS } from "@rube/core";
import { DbToken, jobRuns, jobs } from "@rube/db";
import { createNavRouter } from "./nav.router.ts";
import type { AdminContext } from "./_base.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const navRouter = createNavRouter(services);

function metrics() {
  const ctx = { session: undefined, authRequired: false } as unknown as AdminContext;
  return initTRPC.context<AdminContext>().create().createCallerFactory(navRouter)(ctx).metrics();
}

let seq = 0;
function job(id: string, enabled = 1): void {
  db.insert(jobs).values({ id, name: id, command: id, schedule: "", enabled, config: {} }).run();
}
function run(jobId: string, status: string, ageMs: number): void {
  const at = Date.now() - ageMs;
  db.insert(jobRuns)
    .values({ id: `run-${++seq}`, jobId, status, log: "", progress: 1, message: "", startedAt: at, finishedAt: at })
    .run();
}

beforeEach(() => {
  db.delete(jobRuns).run();
  db.delete(jobs).run();
});

describe("jobsStatus", () => {
  test("is null before anything has finished", async () => {
    job("healthcheck");
    assert.equal((await metrics()).jobsStatus, null);
  });

  test("goes red when any job's latest run failed, not only healthcheck's", async () => {
    job("healthcheck");
    job("posters-refresh");
    run("healthcheck", "completed", 1000);
    run("posters-refresh", "failed", 4 * DAY_MS);
    assert.equal((await metrics()).jobsStatus, "error");
  });

  test("recovers once the failing job succeeds, and ignores a cancel after the failure", async () => {
    job("posters-refresh");
    run("posters-refresh", "failed", 3000);
    run("posters-refresh", "completed", 2000);
    run("posters-refresh", "cancelled", 1000);
    assert.equal((await metrics()).jobsStatus, "ok");
  });

  test("ignores a disabled job's failure", async () => {
    job("healthcheck");
    job("posters-refresh", 0);
    run("healthcheck", "completed", 1000);
    run("posters-refresh", "failed", 1000);
    assert.equal((await metrics()).jobsStatus, "ok");
  });
});
