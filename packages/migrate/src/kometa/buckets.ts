/**
 * Name lists used by the title classifier. The bulk is sourced from the
 * Kometa-Team/Default-Images GitHub tree (snapshot in `data/name-lists.json`)
 * so we cover every Kometa default collection name. Manual additions cover
 * common colloquialisms (e.g. "USA" for "United States of America") and
 * legacy "Disney Plus"-style spellings.
 */
import nameLists from "./data/name-lists.json" with { type: "json" };

const lower = (s: string) => s.trim().toLowerCase();
const set = (xs: Iterable<string>) => new Set([...xs].map(lower));

const COUNTRY_ALIASES = ["USA", "UK", "USSR"];
const NETWORK_ALIASES = ["Disney Plus", "Apple TV Plus", "HBO Max", "Amazon Prime Video"];

export const STUDIO_NAMES = set(nameLists.studio);
export const NETWORK_NAMES = set([...nameLists.network, ...NETWORK_ALIASES]);
export const STREAMING_NETWORK_NAMES = set([...nameLists.streaming, ...NETWORK_ALIASES]);
export const GENRE_NAMES = set(nameLists.genre);
export const COUNTRY_NAMES = set([...nameLists.country, ...COUNTRY_ALIASES]);
export const FRANCHISE_NAMES = set(nameLists.franchise);
export const UNIVERSE_NAMES = set(nameLists.universe);
export const SEASONAL_NAMES = set(nameLists.seasonal);
export const VIDEO_FORMAT_NAMES = set(nameLists.video_format);
export const BASED_ON_NAMES = set(nameLists.based_on);

/** Common Kometa configs append a category suffix to the canonical name. */
export const STRIP_SUFFIXES = [" movies", " films", " shows", " series", " tv shows", " collection", " collections"];

export const RESOLUTION_TOKENS = set(["4k", "2160p", "uhd", "1080p", "1080", "720p", "720", "480p", "sd", "ultra hd"]);

export const VIDEO_FORMAT_TOKENS = set(["blu-ray", "bluray", "dvd", "web-dl", "webrip", "hdtv", "remux"]);

/** ISO-639-1ish English names of common audio/subtitle languages. */
export const LANGUAGE_NAMES = set([
  "Arabic",
  "Cantonese",
  "Chinese",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Finnish",
  "French",
  "German",
  "Greek",
  "Hebrew",
  "Hindi",
  "Hungarian",
  "Indonesian",
  "Italian",
  "Japanese",
  "Korean",
  "Mandarin",
  "Norwegian",
  "Polish",
  "Portuguese",
  "Romanian",
  "Russian",
  "Spanish",
  "Swedish",
  "Tagalog",
  "Tamil",
  "Telugu",
  "Thai",
  "Turkish",
  "Ukrainian",
  "Vietnamese",
]);

export const AWARD_PATTERNS = [
  /\boscar\b/i,
  /\bacademy award/i,
  /\bbafta\b/i,
  /\bcannes\b/i,
  /\bgolden globe/i,
  /\bemmy/i,
  /\bsundance\b/i,
  /\bberlinale\b/i,
  /\bvenice\b/i,
  /\bspirit award/i,
  /\bcritics' choice/i,
];

export const BASED_ON_PATTERNS = [
  /\bbased on (a |the )?true story\b/i,
  /\bbased on (a |the )?novel\b/i,
  /\bbased on (a |the )?book\b/i,
  /\bbased on (a |the )?comic\b/i,
  /\bbased on (a |the )?video game\b/i,
];

export const YEAR_RE = /^\d{4}$/;
export const DECADE_RE = /^\d{4}s$/;

/** Explicit role suffixes Kometa uses to disambiguate same-name people. */
export const DIRECTOR_SUFFIX_RE = /\s*\((directors?|director)\)\s*$/i;
export const ACTOR_SUFFIX_RE = /\s*\((actors?|actor)\)\s*$/i;

/**
 * Heuristic for "looks like a person's name": two to four capitalized tokens
 * each beginning with an uppercase Unicode letter, no digits. Tolerates
 * apostrophes, hyphens, dots (initials), and Latin-extended characters
 * (so "Stellan Skarsgård" / "François Truffaut" / "Penélope Cruz" all
 * match). Used as the last resort for actor classification — runs after
 * every other bucket so "Marvel Studios" / "United Kingdom" don't get
 * pulled in.
 */
export const PERSON_NAME_RE = /^\p{Lu}[\p{L}'’.-]+(?: \p{Lu}[\p{L}'’.-]+){1,3}$/u;

/** Kometa's `Actors Collections` / `Directors Collections` separator headers. */
export const SEPARATOR_NAMES = new Set(
  [
    "Actors Collections",
    "Directors Collections",
    "Studio Collections",
    "Studios Collections",
    "Network Collections",
    "Networks Collections",
    "Genre Collections",
    "Genres Collections",
    "Country Collections",
    "Countries Collections",
    "Decade Collections",
    "Decades Collections",
    "Year Collections",
    "Years Collections",
    "Resolution Collections",
    "Resolutions Collections",
    "Audio Language Collections",
    "Subtitle Language Collections",
    "Award Collections",
    "Awards Collections",
    "Universe Collections",
    "Universes Collections",
    "Franchise Collections",
    "Franchises Collections",
    "Streaming Collections",
    "Chart Collections",
    "Charts Collections",
  ].map((s) => s.toLowerCase()),
);
