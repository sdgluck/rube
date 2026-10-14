import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { noopCheckpoint, type JobContext } from "@tinkerbell/core";
import { parseLogLine, stampLog } from "@tinkerbell/contracts";
import { bufferLog } from "./log-buffer.ts";

describe("bufferLog", () => {
  test("a buffered block keeps the times its lines were written, not when it was flushed", async () => {
    const written: string[] = [];
    // What the real writers do: stamp with the time of the call.
    const outer = {
      log: (...args: unknown[]) => written.push(stampLog(args.map(String).join(" "), Date.now() + 3_600_000)),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    } as unknown as JobContext;
    const { ctx, flush } = bufferLog(outer);
    const before = Date.now();
    ctx.log("first");
    ctx.log("second");
    flush();

    const lines = written.join("\n").split("\n");
    assert.deepEqual(
      lines.map((l) => parseLogLine(l).text),
      ["first", "second"],
    );
    for (const l of lines) {
      const at = parseLogLine(l).at!;
      assert.ok(at >= before && at < before + 60_000, "stamped when written, not an hour later at the flush");
    }
  });
});
