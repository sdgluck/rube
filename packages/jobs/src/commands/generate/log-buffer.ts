import { stampLog } from "@rube/contracts";
import type { JobContext } from "@rube/core";

/**
 * A context whose log is collected rather than emitted, so a unit of work's
 * output lands in the job log as a single contiguous block. Mirrors the real
 * context's stringification so buffered lines read identically to live ones.
 *
 * Used at two levels: per rule (rules interleave when `ruleConcurrency > 1`)
 * and per collection commit (commits interleave within a single rule).
 */
export function bufferLog(ctx: JobContext): { ctx: JobContext; flush: () => void } {
  const lines: string[] = [];
  return {
    ctx: {
      ...ctx,
      // Stamped now, as each line happens: the block is flushed when the unit
      // of work ends, and the writer that receives it keeps these times.
      log: (...args: unknown[]) =>
        lines.push(stampLog(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "), Date.now())),
    },
    flush: () => {
      if (lines.length > 0) ctx.log(lines.join("\n"));
      lines.length = 0;
    },
  };
}
