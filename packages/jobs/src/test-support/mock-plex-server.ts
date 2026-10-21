/**
 * Moved to `@rube/test-support` once a second package needed it.
 *
 * Kept as a re-export rather than updating the four call sites and deleting
 * this file, because the import path is the only thing that changed and a
 * one-line forward is cheaper to read than a diff across four test files.
 *
 * Note there is a *second*, unrelated mock Plex at
 * `apps/rube.fyi/harness/mock-plex.ts`. It is not this one and should not
 * be merged into it casually: that one exists to seed the screenshot capture
 * with a plausible-looking library, so it optimises for breadth of content,
 * while this one optimises for recording what the job asked it to do.
 */
export * from "@rube/test-support/plex";
