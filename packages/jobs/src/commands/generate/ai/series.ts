/**
 * Which series a film belongs to, guessed from its title, so a
 * recommender-filled AI theme can't be taken over by one franchise. A run
 * seeded with The Bunker and The Penguin Lessons came back with all eight
 * Harry Potter films in a 30-title political-drama collection: franchise
 * entries sit almost on top of each other in the recommender, so once one
 * ranks, the rest follow it in.
 *
 * From the title rather than TMDb's "belongs to collection" because that is a
 * lookup per film, and the media index doesn't hold it. A title stem is wrong
 * in both directions now and then — two unrelated films called "Halloween",
 * or a franchise that renames itself — but all a key does here is cap how
 * many titles share one, so a wrong guess costs a title, not a collection.
 */

const ROMAN = /\s+(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/;
const SEQUEL = /\s+(?:\d+|part\s+\w+|chapter\s+\w+|vol(?:ume|\.)?\s*\w+|episode\s+\w+)$/;

export function seriesKey(title: string): string {
  let key = title.toLowerCase().trim();
  // "Mission: Impossible - Fallout", "The Land Before Time VIII: The Big Freeze".
  key = key.split(/\s*:\s*|\s+[-–—]\s+/)[0]!;
  // "Harry Potter and the Chamber of Secrets", "Indiana Jones and the Temple
  // of Doom" — only with two words or more before it, so "Beauty and the
  // Beast" stays whole.
  const andThe = key.match(/^(\S+\s+\S+.*?)\s+and\s+the\s+/);
  if (andThe) key = andThe[1]!;
  key = key.replace(/^(?:the|a|an)\s+/, "");
  for (let prev = ""; prev !== key; ) {
    prev = key;
    key = key.replace(ROMAN, "").replace(SEQUEL, "").trim();
  }
  return key;
}

/** Most titles from one series a single collection may hold. */
export const MAX_PER_SERIES = 2;
