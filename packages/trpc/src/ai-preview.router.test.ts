/**
 * The Try-it lifecycle: start answers at once, progress is polled, and a stop
 * reaches the model call.
 *
 * The preview itself is stubbed — its prompt and parsing are the job's own
 * code, covered with the job. What lives here is the part that broke: one
 * request held open for the whole run, cut off by a reverse proxy at 60s.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAiPreviewRouter } from "./ai-preview.router.ts";
import { t, type AdminContext } from "./_base.ts";
import type { TrpcDeps } from "./deps.ts";

type Preview = TrpcDeps["jobs"]["previewBecauseYouWatched"];

function setup(preview: Preview) {
  const router = createAiPreviewRouter({ jobs: { previewBecauseYouWatched: preview } as TrpcDeps["jobs"] });
  const ctx = {
    resHeaders: new Headers(),
    secure: false,
    origin: "http://admin.tinkerbell.test",
    ip: "test",
    authRequired: false,
  } as unknown as AdminContext;
  return t.createCallerFactory(router)(ctx).becauseYouWatched;
}

const RESULT = { sectionTitle: "Films", user: null, libraryTitles: 3, minItems: 2, rows: [] };
const INPUT = { sectionKey: "1", count: 1 };

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await read();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting");
}

describe("aiPreview.becauseYouWatched", () => {
  test("start returns before the preview finishes, and status reports its steps then its result", async () => {
    let finish!: () => void;
    const api = setup(async (_input, _signal, onStep) => {
      onStep?.("Reading every title in Films…");
      await new Promise<void>((r) => (finish = r));
      return RESULT;
    });

    const { id } = await api.start(INPUT);
    const running = await api.status({ id });
    assert.equal(running.state, "running");
    assert.deepEqual(
      running.steps.map((s) => s.message),
      ["Started.", "Reading every title in Films…"],
    );

    finish();
    const done = await until(
      () => api.status({ id }),
      (s) => s.state !== "running",
    );
    assert.equal(done.state, "done");
    assert.deepEqual(done.result, RESULT);
  });

  test("a second start while one runs is refused rather than paid for twice", async () => {
    let finish!: () => void;
    const api = setup(async () => {
      await new Promise<void>((r) => (finish = r));
      return RESULT;
    });
    const { id } = await api.start(INPUT);
    await assert.rejects(api.start(INPUT), /already running/);
    finish();
    await until(
      () => api.status({ id }),
      (s) => s.state !== "running",
    );
    await api.start(INPUT);
    finish();
  });

  test("a failure is reported on status with its message", async () => {
    const api = setup(async () => {
      throw new Error("No watch history in Films to build from.");
    });
    const { id } = await api.start(INPUT);
    const s = await until(
      () => api.status({ id }),
      (v) => v.state !== "running",
    );
    assert.equal(s.state, "failed");
    assert.equal(s.error, "No watch history in Films to build from.");
  });

  test("cancel aborts the signal the model call is waiting on", async () => {
    const api = setup(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const { id } = await api.start(INPUT);
    await api.cancel({ id });
    const s = await until(
      () => api.status({ id }),
      (v) => v.state !== "running",
    );
    assert.equal(s.state, "cancelled");
    assert.equal(s.error, "Stopped.");
  });
});
