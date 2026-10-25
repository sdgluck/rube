/**
 * The parts of an AI-built collection job that Because You Watched and We
 * Think You'd Like have in common: reaching Plex, choosing the libraries,
 * reading a model's JSON and matching its titles back to the library.
 *
 * Shared rather than copied because the two jobs answer the same questions
 * ("which libraries?", "is this title in Plex?") and a fix to one — say a
 * tolerant JSON fallback for a model that wraps its answer in prose — must
 * not leave the other answering differently.
 */
import type { Services } from "@rube/composition";
import type { PlexClient, PlexItem, PlexSection } from "@rube/plex";

/** Where Plex is, from Settings, falling back to the environment. */
export function plexConnection(getConfig: Services["config"]["getConfig"]): {
  url: string;
  token: string | undefined;
} {
  return {
    url: getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400",
    token: getConfig("global_plex_token") || process.env.PLEX_TOKEN,
  };
}

/**
 * The libraries a run covers: the ones Rube manages, narrowed by the
 * job's own `sections` (by key or title). Throws when a narrowing names
 * nothing, so a renamed library reads as a misconfiguration rather than a run
 * that quietly did nothing.
 */
export async function resolveTargetSections(
  client: PlexClient,
  getConfig: Services["config"]["getConfig"],
  sections: string[] | undefined,
): Promise<PlexSection[]> {
  let all = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    all = all.filter((s) => configuredLibraries.includes(s.title));
  }
  if (!sections || sections.length === 0) return all;
  const names = sections.map((s) => s.trim().toLowerCase());
  const target = all.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
  if (target.length === 0) {
    throw new Error(`No matching sections found for "${sections.join(", ")}".`);
  }
  return target;
}

/** How a library item is named in a prompt, and so how the model names it back. */
export function itemLabel(item: Pick<PlexItem, "title" | "year">): string {
  return `${item.title}${item.year ? ` (${item.year})` : ""}`;
}

/**
 * The model's titles to rating keys. `Title (Year)` first, then the bare
 * title — a model that drops the year still matches, and two films sharing a
 * title still resolve correctly when it doesn't.
 */
export function libraryTitleMap(items: PlexItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(itemLabel(item), item.ratingKey);
    if (!map.has(item.title)) map.set(item.title, item.ratingKey);
  }
  return map;
}

/**
 * `libraryTitleMap`, plus one more chance for a title whose year is wrong:
 * the model names "The Crown (2019)" for a library's "The Crown (2016)", and
 * sometimes a run of them, one per invented year. Without the year it is
 * matched, but only to a title the library holds once — a remake sharing the
 * name must not be picked for a year that belongs to neither.
 */
export function libraryTitleMatcher(items: PlexItem[]): (title: string) => string | undefined {
  const map = libraryTitleMap(items);
  const byBare = new Map<string, string | null>();
  for (const item of items) byBare.set(item.title, byBare.has(item.title) ? null : item.ratingKey);
  return (title) => {
    const exact = map.get(title);
    if (exact) return exact;
    const bare = title.replace(/\s*\(\d{4}\)$/, "");
    return bare === title ? undefined : (byBare.get(bare) ?? undefined);
  };
}

/**
 * Best-effort JSON extraction for LLM responses. Tries strict parse, then
 * the first bracketed object, then a cleaned variant (no trailing commas /
 * control chars), then the first bracketed array. Returns null when none
 * succeed; each catch is an intentional "try the next fallback".
 */
export function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to bracketed-object extraction
  }

  // indexOf/lastIndexOf rather than `/\{[\s\S]*\}/`: the same first-to-last
  // span, without a backtracking scan from every brace in a long run of them.
  const objMatch = outermost(text, "{", "}");
  if (objMatch) {
    try {
      return JSON.parse(objMatch);
    } catch {
      // fall through to cleaned variant
    }

    // eslint-disable-next-line no-control-regex
    const cleaned = objMatch.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]/g, " ");
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall through to bracketed-array extraction
    }
  }

  const arrMatch = outermost(text, "[", "]");
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch);
    } catch {
      // exhausted fallbacks; caller treats `null` as "couldn't parse"
    }
  }

  return null;
}

function outermost(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}
