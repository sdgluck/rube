import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * Escape SQL LIKE wildcards in user-supplied substrings. Without this,
 * a search for `100%` or `a_b` matches more rows than the user intended.
 *
 * Pair with {@link likeContains}/{@link likeStarts} so the `ESCAPE '\\'`
 * clause is always emitted alongside.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/**
 * `column LIKE '%<escaped>%' ESCAPE '\\'` — substring match with the user's
 * wildcards treated as literals.
 */
export function likeContains(column: SQLWrapper, needle: string) {
  return sql`${column} LIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\'`;
}
