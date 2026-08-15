/**
 * The cleanup pass, as its own job.
 *
 * Shares the batch engine with `generate` — same selection handlers, same
 * resume, same concurrency — and differs only in which rules it owns. See
 * `runCleanup` for why it is a separate job rather than a branch.
 */
export { runCleanup as default } from "./generate/index.ts";
