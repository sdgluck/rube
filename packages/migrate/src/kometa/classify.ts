import type { BucketKind, ClassifiedCollection, CollectionInput } from "../types.ts";
import {
  ACTOR_SUFFIX_RE,
  AWARD_PATTERNS,
  BASED_ON_NAMES,
  BASED_ON_PATTERNS,
  COUNTRY_NAMES,
  DECADE_RE,
  DIRECTOR_SUFFIX_RE,
  FRANCHISE_NAMES,
  GENRE_NAMES,
  LANGUAGE_NAMES,
  NETWORK_NAMES,
  PERSON_NAME_RE,
  RESOLUTION_TOKENS,
  SEASONAL_NAMES,
  SEPARATOR_NAMES,
  STREAMING_NETWORK_NAMES,
  STRIP_SUFFIXES,
  STUDIO_NAMES,
  UNIVERSE_NAMES,
  VIDEO_FORMAT_NAMES,
  VIDEO_FORMAT_TOKENS,
  YEAR_RE,
} from "./buckets.ts";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Build the set of plausible name keys for a title — the title itself plus
 * any common Kometa-config suffix stripped (e.g. "Action Movies" → "action").
 * Keeps lookups exact-match while tolerating the most common naming variant.
 */
function nameCandidates(title: string): string[] {
  const base = norm(title);
  const out = new Set<string>([base]);
  for (const suffix of STRIP_SUFFIXES) {
    if (base.endsWith(suffix)) out.add(base.slice(0, -suffix.length).trim());
  }
  return [...out].filter((s) => s.length > 0);
}

function anyIn(haystack: ReadonlySet<string>, candidates: string[]): boolean {
  return candidates.some((c) => haystack.has(c));
}

/**
 * Single-collection classifier. Order matters — the more specific patterns
 * (year, decade, resolution) run before the curated name lookups so a
 * collection literally titled "1995" doesn't match the studio list by
 * accident.
 */
export function classifyOne(collection: CollectionInput): { bucket: BucketKind | null; reason?: string } {
  const title = collection.title.trim();
  const lower = norm(title);

  // Explicit role suffix wins outright — "Brian De Palma (Director)" should
  // never get re-routed by a downstream lookup.
  if (DIRECTOR_SUFFIX_RE.test(title)) return { bucket: "director" };
  if (ACTOR_SUFFIX_RE.test(title)) return { bucket: "actor" };

  if (SEPARATOR_NAMES.has(lower)) {
    return { bucket: null, reason: "Kometa separator collection — leave or delete manually" };
  }

  if (YEAR_RE.test(title)) return { bucket: "year" };
  if (DECADE_RE.test(title)) return { bucket: "decade" };
  if (RESOLUTION_TOKENS.has(lower)) return { bucket: "resolution" };
  if (VIDEO_FORMAT_TOKENS.has(lower) || VIDEO_FORMAT_NAMES.has(lower)) return { bucket: "video_format" };

  if (AWARD_PATTERNS.some((re) => re.test(title))) return { bucket: "award" };

  const candidates = nameCandidates(title);

  if (anyIn(BASED_ON_NAMES, candidates) || BASED_ON_PATTERNS.some((re) => re.test(title))) {
    return { bucket: "based_on" };
  }

  if (anyIn(SEASONAL_NAMES, candidates)) return { bucket: "seasonal" };
  // Kometa's `universe/` folder uses short keys (mcu, dca, …); the
  // display-name lookups for those collections actually live in the
  // `franchise/` list, so we route everything through franchise here
  // and the user can promote individual rules to universe-style
  // post-migration if they want.
  if (anyIn(FRANCHISE_NAMES, candidates) || anyIn(UNIVERSE_NAMES, candidates)) {
    return { bucket: "franchise" };
  }

  // Streaming first so a Netflix collection doesn't get classed as just
  // a network — it's the more specific bucket.
  if (anyIn(STREAMING_NETWORK_NAMES, candidates)) return { bucket: "streaming" };
  if (anyIn(NETWORK_NAMES, candidates)) return { bucket: "network" };
  if (anyIn(STUDIO_NAMES, candidates)) return { bucket: "studio" };
  if (anyIn(GENRE_NAMES, candidates)) return { bucket: "genre" };
  if (anyIn(COUNTRY_NAMES, candidates)) return { bucket: "country" };

  // Audio/subtitle ambiguity: a collection titled "Mandarin" could be
  // either. Without further signal, classify as audio_language by
  // convention — most Kometa setups generate audio first and far more
  // often than subs. (Country-aliased language names like "French" land
  // in `country` above, matching Kometa's own folder convention.)
  if (anyIn(LANGUAGE_NAMES, candidates)) return { bucket: "audio_language" };

  // Last resort: looks like a person's name → actor. Runs after every
  // explicit lookup so "Marvel Studios" / "United Kingdom" / etc. don't
  // get pulled in. Directors without an explicit "(Director)" suffix
  // unfortunately fall here too — there's no purely-textual signal to
  // distinguish; the Tinkerbell `actors` rule will still pick them up
  // via TMDb when run.
  if (PERSON_NAME_RE.test(title)) return { bucket: "actor" };

  return { bucket: null, reason: "no matching pattern or curated name" };
}

export function classifyCollections(collections: CollectionInput[]): ClassifiedCollection[] {
  return collections.map((collection) => {
    const { bucket, reason } = classifyOne(collection);
    return { collection, bucket, reason };
  });
}
