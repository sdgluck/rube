/**
 * When each line of a run's log was written.
 *
 * Stored in the log text itself, as an ISO time at the start of each line,
 * rather than in a column beside it: the log is appended to with `log || ?`
 * as it streams, read whole by the viewer, the MCP and Download, and every one
 * of those already handles text. A stamp per line is ~25 bytes against a
 * format change in four writers and three readers.
 *
 * Stamped when the line is *written*, not when its block is flushed: a rule's
 * lines are buffered and land in the job log together when it finishes, and
 * stamping at the flush would give a ten-minute rule ten minutes of identical
 * times. So the buffer stamps, and the outer writer leaves stamped lines alone
 * — which is why `stampLog` skips a line that already has one.
 *
 * Here, in contracts, because the server writes the format and the browser
 * reads it.
 */
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) /;

/** `text` with every non-empty line that isn't already stamped prefixed with `at`. */
export function stampLog(text: string, at: number): string {
  const stamp = `${new Date(at).toISOString()} `;
  return text
    .split("\n")
    .map((line) => (line === "" || STAMP.test(line) ? line : stamp + line))
    .join("\n");
}

/** One stored line: its time, when it has one (runs from before stamping don't), and its text. */
export function parseLogLine(line: string): { at?: number; text: string } {
  const m = STAMP.exec(line);
  return m ? { at: Date.parse(m[1]!), text: line.slice(m[0].length) } : { text: line };
}
