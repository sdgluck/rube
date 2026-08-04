/**
 * The level is parsed once at import, so each behaviour needs a fresh module
 * instance with the env set beforehand — hence the dynamic imports with a
 * cache-busting query string.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

type LoggerModule = typeof import("./logger.ts");

let instance = 0;
async function loadLogger(env: Record<string, string | undefined>): Promise<LoggerModule> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = (await import(`./logger.ts?instance=${instance++}`)) as LoggerModule;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

/** Capture whatever the logger writes to console during `fn`. */
function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const sinks = ["log", "warn", "error"] as const;
  const originals = sinks.map((s) => console[s]);
  for (const s of sinks) console[s] = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    sinks.forEach((s, i) => (console[s] = originals[i]));
  }
  return lines;
}

describe("createLogger", () => {
  it("defaults to info and suppresses debug", async () => {
    const { createLogger, logLevel } = await loadLogger({ LOG_LEVEL: undefined, LOG_FORMAT: undefined });
    assert.equal(logLevel(), "info");

    const log = createLogger("jobs");
    const lines = capture(() => {
      log.debug("invisible");
      log.info("visible");
    });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /INFO {2}\[jobs] visible/);
  });

  it("honours LOG_LEVEL", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "error", LOG_FORMAT: undefined });
    const log = createLogger("jobs");
    const lines = capture(() => {
      log.warn("dropped");
      log.error("kept");
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /ERROR \[jobs] kept/);
  });

  it("treats an unrecognised level as info, and trace/verbose as debug", async () => {
    const nonsense = await loadLogger({ LOG_LEVEL: "chatty", LOG_FORMAT: undefined });
    assert.equal(nonsense.logLevel(), "info");

    const trace = await loadLogger({ LOG_LEVEL: "trace", LOG_FORMAT: undefined });
    assert.equal(trace.logLevel(), "debug");
  });

  it("renders fields as key=value, quoting only when needed", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "info", LOG_FORMAT: undefined });
    const log = createLogger("jobs");
    const [line] = capture(() =>
      log.info("enqueued", { command: "generate", job: "Generate Collections", count: 3, ok: true }),
    );

    assert.match(line, /command=generate/);
    assert.match(line, /job="Generate Collections"/);
    assert.match(line, /count=3/);
    assert.match(line, /ok=true/);
  });

  it("omits undefined fields", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "info", LOG_FORMAT: undefined });
    const [line] = capture(() => createLogger("jobs").info("hi", { present: 1, missing: undefined }));
    assert.match(line, /present=1/);
    assert.doesNotMatch(line, /missing/);
  });

  it("emits one JSON object per line when LOG_FORMAT=json", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "info", LOG_FORMAT: "json" });
    const [line] = capture(() => createLogger("jobs").warn("careful", { runId: "abc" }));

    const parsed = JSON.parse(line);
    assert.equal(parsed.level, "warn");
    assert.equal(parsed.scope, "jobs");
    assert.equal(parsed.msg, "careful");
    assert.equal(parsed.runId, "abc");
    assert.ok(Date.parse(parsed.ts));
  });

  it("stamps child fields onto every line", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "info", LOG_FORMAT: "json" });
    // This is how CommandJob correlates every line with its run.
    const child = createLogger("jobs").child({ runId: "r1", command: "generate" });
    const [line] = capture(() => child.info("completed", { durationMs: 12 }));

    const parsed = JSON.parse(line);
    assert.equal(parsed.runId, "r1");
    assert.equal(parsed.command, "generate");
    assert.equal(parsed.durationMs, 12);
  });

  it("does not let a per-call field leak into later lines", async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: "info", LOG_FORMAT: "json" });
    const log = createLogger("jobs");
    const lines = capture(() => {
      log.info("first", { once: true });
      log.info("second");
    });
    assert.equal(JSON.parse(lines[1]).once, undefined);
  });
});
