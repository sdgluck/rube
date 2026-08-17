/* ─── Palette scopes ────────────────────────────────────────────────────────
 *
 * `rule: nolan` searches rules only. The palette indexes eleven kinds, so on a
 * populated library a two-word query returns a wall in which the thing you
 * wanted is fourth in the fifth group — and the one fact you always know about
 * what you are looking for is what *sort* of thing it is.
 *
 * Separate from the hook so the parsing can be tested without dragging React
 * and a tRPC client into a node test.
 */

export type SearchKind =
  | "navigation"
  | "command"
  | "recent"
  | "collection"
  | "media"
  | "rule"
  | "job"
  | "overlayPreset"
  | "event"
  | "plexUser"
  | "plexSection"
  | "preroll";

/**
 * Both a one-letter and a full-word spelling for each: the short form is what
 * you type once you know it, the long form is what you guess. The first
 * prefix listed is the one the footer advertises.
 */
export const SCOPES: { prefixes: string[]; kinds: SearchKind[]; label: string }[] = [
  { prefixes: ["a", "action", "do", "run"], kinds: ["command"], label: "Actions" },
  { prefixes: ["g", "go", "nav"], kinds: ["navigation"], label: "Navigation" },
  { prefixes: ["c", "collection", "collections"], kinds: ["collection"], label: "Collections" },
  { prefixes: ["m", "media", "film", "movie"], kinds: ["media"], label: "Media" },
  { prefixes: ["r", "rule", "rules"], kinds: ["rule"], label: "Rules" },
  { prefixes: ["j", "job", "jobs"], kinds: ["job"], label: "Jobs" },
  { prefixes: ["o", "overlay", "preset"], kinds: ["overlayPreset"], label: "Overlay presets" },
  { prefixes: ["p", "preroll", "prerolls"], kinds: ["preroll"], label: "Prerolls" },
  { prefixes: ["s", "section", "library"], kinds: ["plexSection"], label: "Plex sections" },
  { prefixes: ["u", "user", "users"], kinds: ["plexUser"], label: "Users" },
  { prefixes: ["e", "event", "events"], kinds: ["event"], label: "Events" },
];

export interface ParsedQuery {
  /** What to actually search for, with the scope stripped off. */
  text: string;
  /** Null when unscoped. */
  scope: { label: string; kinds: SearchKind[] } | null;
}

/**
 * Splits `rule: nolan` into a scope and a query.
 *
 * A colon that doesn't name a scope is left alone — someone searching for a
 * collection called "Marvel: Phase One" is not addressing the palette, and a
 * palette that swallowed the first word of that query would be worse than one
 * with no scopes at all.
 */
export function parseQuery(raw: string): ParsedQuery {
  const match = raw.match(/^([a-zA-Z]+):\s*(.*)$/s);
  if (!match) return { text: raw, scope: null };
  const scope = SCOPES.find((s) => s.prefixes.includes(match[1].toLowerCase()));
  if (!scope) return { text: raw, scope: null };
  return { text: match[2], scope: { label: scope.label, kinds: scope.kinds } };
}
