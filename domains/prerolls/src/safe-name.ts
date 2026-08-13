/**
 * The one check standing between a browser-supplied string and a filesystem
 * path, kept in its own leaf module so it can be tested without opening a
 * database.
 */

import { basename } from "node:path";

/**
 * Whether `filename` may be joined onto the prerolls directory.
 *
 * Anything carrying a path is rejected rather than normalised. Adoption only
 * ever names a file the scan just listed — a bare entry at the top level of
 * `PREROLLS_DIR` — so there is no legitimate caller that sends a separator, a
 * `..`, or an absolute path, and stripping them would turn a hostile input
 * into a plausible one instead of an obvious error.
 */
export function isBareFilename(filename: string): boolean {
  if (!filename || filename === "." || filename === "..") return false;
  // Backslashes are checked explicitly: `basename` on POSIX treats them as
  // ordinary characters, so `..\\..\\etc` would pass on Linux and mean
  // something quite different if the string ever reached a Windows API.
  if (filename.includes("/") || filename.includes("\\") || filename.includes("\0")) return false;
  return basename(filename) === filename;
}
