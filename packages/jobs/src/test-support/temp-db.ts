/**
 * Re-export of the shared helper, kept so the eleven test files that import
 * from here don't all have to change. New tests should import
 * `@tinkerbell/db/test-support` directly.
 *
 * See that module for why the schema is applied by spawning `migrate.ts`
 * rather than calling it in-process.
 */
export { setupTempDb } from "@tinkerbell/db/test-support";
