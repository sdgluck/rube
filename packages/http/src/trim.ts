/**
 * Trailing-separator trimming without a regex.
 *
 * `s.replace(/\/+$/, "")` reads as linear but isn't: the engine retries the
 * `\/+` run from every slash in it and only fails at the `$`, so a string of n
 * slashes followed by anything else costs O(n²). Every caller passes a URL or
 * path a user typed into Settings, so this is the shape that can't be made to
 * spin — CodeQL flagged eleven copies of the regex as `js/polynomial-redos`.
 */
export function trimTrailing(value: string, chars = "/"): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end--;
  return value.slice(0, end);
}
