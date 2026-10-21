/**
 * Names for recommender-filled AI collections, given after the titles are
 * known rather than before.
 *
 * In that mode the model names a theme from three or four examples, and the
 * recommender then decides what the collection actually holds. The two drift
 * apart: "Modern Day Sleek Thriller Mood" was seeded with Gone with the Wind,
 * The Shining and The Birds and filled with Casablanca, The Sound of Music and
 * Singin' in the Rain. One short call over the finished rosters fixes every
 * name at once, and a name the model fumbles keeps the one it had.
 */
import type { HistoricalCollection } from "@rube/domain.rule-history";
import { VIBE_HINTS, NAME_STYLE_HINTS, type RuleConfig } from "#commands/generate/config.ts";

/** Titles shown per collection: enough to read the group, few enough to keep the call short. */
export const TITLES_PER_COLLECTION = 15;

/** Longest name accepted back; anything longer is the model writing a sentence. */
const MAX_NAME_LENGTH = 60;

export const NAMES_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: { index: { type: "integer" }, name: { type: "string" } },
    required: ["index", "name"],
  },
};

export const NAMES_REMINDER = `Reminder: return ONLY the JSON described above, one name per numbered collection.`;

export function buildNamingPrompt(args: {
  sectionTitle: string;
  count: number;
  vibe?: RuleConfig["vibe"];
  nameStyle?: RuleConfig["nameStyle"];
  history: HistoricalCollection[];
}): string {
  const { sectionTitle, count, vibe, nameStyle, history } = args;
  const vibeLine = vibe ? VIBE_HINTS[vibe] : "";
  const nameLine = nameStyle ? NAME_STYLE_HINTS[nameStyle] : "";
  const used = history.map((h) => `"${h.name}"`).join(", ");

  return `You are naming curated collections in a Plex "${sectionTitle}" library. Each of the ${count} numbered lines inside the data block below is one finished collection: its working name, then the titles it holds.

Rules:
- Give every collection a new name that says what its titles genuinely have in common. Name what is there, not what the working name hoped for.
- Names must be creative, relatively short, not academic, and NEVER use colons.
- Every name must be different from the others${used ? ` and from these earlier ones: ${used}` : ""}.
${vibeLine ? `- ${vibeLine}\n` : ""}${nameLine ? `- ${nameLine}\n` : ""}
Return ONLY valid minified JSON on a single line, no markdown fences, no explanation. Format:
[{"index":1,"name":"Collection Name"},{"index":2,"name":"Collection Name"}]`;
}

/** One line per collection, so the per-call line cap and the fence still hold. */
export function namingList(collections: Array<{ name: string; titles: string[] }>): string {
  return collections
    .map((c, i) =>
      `${i + 1}. "${c.name}": ${c.titles.slice(0, TITLES_PER_COLLECTION).join("; ")}`.replace(/[\r\n]+/g, " "),
    )
    .join("\n");
}

/**
 * The new name for each collection, by position, or undefined where the model
 * gave none usable — missing, empty, too long, or a repeat of a name already
 * given. Anything unparseable is all undefined: the caller keeps its names.
 */
export function parseNames(text: string, count: number): (string | undefined)[] {
  const out: (string | undefined)[] = Array.from({ length: count });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? text);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  const taken = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { index, name } = entry as { index?: unknown; name?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > count) continue;
    if (typeof name !== "string") continue;
    const clean = name
      .replace(/[\r\n]+/g, " ")
      .replace(/:/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const key = clean.toLowerCase();
    if (!clean || clean.length > MAX_NAME_LENGTH || taken.has(key) || out[index - 1] !== undefined) continue;
    taken.add(key);
    out[index - 1] = clean;
  }
  return out;
}
