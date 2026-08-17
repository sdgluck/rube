import { readJsonStorage, writeJsonStorage } from "#/storage";
import type { SearchHit } from "#hooks/useGlobalSearch";

/* ─── What you opened last ───────────────────────────────────────────────────
 *
 * The palette's most common use is not discovery, it is going back: to the rule
 * you were editing, the collection you were checking, the job whose run you
 * were watching. Without a memory that costs the same twelve keystrokes every
 * time.
 *
 * Destinations only. A command's `run` is a closure over live mutations and
 * cannot be serialised, and re-firing "Run rule: Nightly" from a list of things
 * you did earlier is not a convenience — it is a way to start a Plex write by
 * pressing Enter on the resting state of a panel.
 *
 * Local to the browser rather than server config: this is scratch, it changes
 * on nearly every navigation, and it is nobody else's business which titles an
 * admin has been looking at.
 */

const KEY = "tb.palette.recents";
const MAX = 6;

/** No `kind`: everything read back out of here is grouped as "Recent". */
type Recent = Pick<SearchHit, "id" | "title" | "subtitle" | "href">;

export function readRecents(): SearchHit[] {
  const stored = readJsonStorage<Recent[]>(KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((r) => r && typeof r.href === "string" && r.href !== "" && typeof r.title === "string")
    .slice(0, MAX)
    .map((r) => ({ ...r, kind: "recent" as const }));
}

/** Records a selection, most recent first, de-duplicated by destination. */
export function pushRecent(hit: SearchHit): void {
  if (!hit.href || hit.run) return;
  const entry: Recent = {
    id: hit.id,
    title: hit.title,
    subtitle: hit.subtitle,
    href: hit.href,
  };
  const rest = readRecents().filter((r) => r.href !== entry.href);
  writeJsonStorage(KEY, [entry, ...rest].slice(0, MAX));
}
