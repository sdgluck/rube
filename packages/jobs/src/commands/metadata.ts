/**
 * The metadata pass, as its own job.
 *
 * Shares the batch engine with `generate` — same selection handlers, same
 * resume, same concurrency — and differs only in which rules it owns. See
 * `runMetadata` for why it is a separate job rather than a branch.
 */
export { runMetadata as default } from "./generate/index.ts";
