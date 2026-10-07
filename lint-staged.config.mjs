/**
 * `packages/db/drizzle/**` is excluded from formatting: those files are written
 * by drizzle-kit, and reformatting one is exactly the hand-edit the project
 * forbids. Left in, `pnpm format` rewrote an old snapshot on every run and
 * `format:check` then failed on a file nobody had touched.
 *
 * The Capacitor projects (`apps/{web,portal}/{ios,android}`) are excluded for
 * the same reason: their JSON is written by `cap sync` and Xcode, which put
 * back their own formatting on every sync.
 */
const NATIVE_PROJECT = /(^|\/)apps\/[^/]+\/(ios|android)\//;
const NOT_GENERATED = (files) => files.filter((f) => !f.includes("/packages/db/drizzle/") && !NATIVE_PROJECT.test(f));

export default {
  "*.{ts,tsx}": ["oxlint", "oxfmt", () => "pnpm typecheck"],
  "*.{js,jsx,json,html,md}": (files) => {
    const keep = NOT_GENERATED(files);
    return keep.length > 0 ? [`oxfmt ${keep.join(" ")}`] : [];
  },
  /* Stylelint before oxfmt: the token and primitive rules are the ones worth
     failing a commit over, and there is no point formatting a stylesheet that
     is about to be sent back. */
  "*.css": ["stylelint", "oxfmt"],
};
