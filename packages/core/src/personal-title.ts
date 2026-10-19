/**
 * A per-person row's title: what the person reads, plus invisible marks that
 * make it theirs alone.
 *
 * Plex keeps collection membership as a tag on each item, named by the
 * collection's title. Two collections with the same title in a library are
 * two objects over one shared set of items — so twelve people's "We Think
 * You'd Like" rows were twelve views of one pooled 203-film list, and when
 * Because You Watched deleted one person's "Because you watched Silo", the
 * tag came off the films and every other person's row of that name emptied.
 * Labels keep the *objects* apart; only the title keeps the *contents* apart.
 *
 * So each person's title ends in 32 zero-width characters spelling a hash of
 * their username: unique per person, stable across runs, and invisible on
 * every Plex client. Verified against a real server on 2026-10-14: Plex keeps
 * the marks, the two collections hold separate items, and deleting one leaves
 * the other intact.
 *
 * Anything that compares a row's title to a name a person typed or saw — the
 * portal's "Not for me", a job's own fixed row name — compares `displayTitle`
 * of both, never the raw title.
 */
// From code points, not string escapes: the formatter rewrites "\u200b" into
// the literal character, which leaves an invisible character in the source of
// the one file whose job is to keep track of them.
const ZERO = String.fromCharCode(0x200b); // zero-width space
const ONE = String.fromCharCode(0x200c); // zero-width non-joiner
const MARKS = new RegExp(`[${ZERO}${ONE}]+$`);

/** FNV-1a, 32-bit: a stable spread of usernames over the marks, not a secret. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function marked(title: string, key: string): string {
  const bits = hash(key).toString(2).padStart(32, "0");
  return displayTitle(title) + [...bits].map((b) => (b === "1" ? ONE : ZERO)).join("");
}

/** `title` made unique to `username` — reads identically, tags separately. */
export function personalRowTitle(title: string, username: string): string {
  return marked(title, username.toLowerCase());
}

/**
 * `title` made unique to one rule, for a shared collection whose name another
 * collection in the library already has — Actors and Directors both building
 * "Quentin Tarantino" in Films. Without it the second is a shell and its films
 * land in the first. Keyed apart from usernames so a rule's marks can't equal
 * a person's.
 */
export function ruleRowTitle(title: string, ruleId: string): string {
  return marked(title, `rule:${ruleId}`);
}

/**
 * `title` made unique to one season, for a Season Collections row. Its
 * "Christmas" would otherwise pool its films with a `seasonal` rule's
 * "Christmas" in the same library, and taking the row down out of season
 * would empty the rule's collection with it.
 */
export function seasonRowTitle(title: string, seasonKey: string): string {
  return marked(title, `season:${seasonKey}`);
}

/** A title as people read it: the per-person marks removed. */
export function displayTitle(title: string): string {
  return title.replace(MARKS, "");
}
