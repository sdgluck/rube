/**
 * Fakes that speak real HTTP, shared across packages.
 *
 * Everything here exists because a `fetch` stub agrees with you. It
 * short-circuits URL construction, parameter encoding, which endpoint a
 * mutation is addressed to, and how a response is parsed — and two real bugs in
 * this codebase lived in exactly those places: a label PUT sent to the wrong
 * path, and a 200 with an empty body parsed as JSON. A stub agreed with both.
 *
 * These are models of Plex and *Arr, not the real things. They cannot tell you
 * what a real server accepts, only that the client is internally consistent
 * with the shape documented in each file.
 *
 * Nothing here is imported by production code, and the package is a
 * `devDependency` everywhere it is used, so it does not reach the image.
 */
export * from "./arr-fixtures.ts";
export * from "./mock-arr-server.ts";
export * from "./mock-list-server.ts";
export * from "./mock-plex-server.ts";
