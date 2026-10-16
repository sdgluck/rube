import type { HistoricalCollection } from "@tinkerbell/domain.rule-history";
import { preferencesPromptBlock, type UserPreferences } from "@tinkerbell/core";
import { VIBE_HINTS, NAME_STYLE_HINTS, type RuleConfig } from "#commands/generate/config.ts";

export function buildAiPrompt(args: {
  sectionTitle: string;
  limit: number;
  minItems: number;
  /** Absent is 30, the ceiling the prompt always asked for. */
  maxItems?: number;
  /** `recommender`: ask only for each theme's defining examples; the recommender fills the rest. */
  fill?: RuleConfig["aiFill"];
  themes: string[];
  customThemes: string[];
  vibe?: RuleConfig["vibe"];
  nameStyle?: RuleConfig["nameStyle"];
  history: HistoricalCollection[];
  preferences?: UserPreferences;
  /**
   * A top-up call: themes this run already kept or tried, and every title
   * already given as an example, so the model looks somewhere else.
   */
  taken?: { names: string[]; titles: string[] };
}): string {
  const { sectionTitle, limit, minItems, themes, customThemes, vibe, nameStyle, history, preferences } = args;
  const maxItems = Math.max(args.maxItems ?? 30, minItems);
  const prefsBlock = preferences ? preferencesPromptBlock(preferences) : "";

  const allThemes = [...themes, ...customThemes].filter((t) => t.trim().length > 0);
  const themesBlock =
    allThemes.length > 0
      ? `Lean into these angles when forming collections: ${allThemes.map((t) => `"${t}"`).join(", ")}.`
      : `Use any inventive angle: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes.`;

  const vibeLine = vibe ? VIBE_HINTS[vibe] : "";
  const nameLine = nameStyle ? NAME_STYLE_HINTS[nameStyle] : "";

  const historyBlock =
    history.length === 0
      ? "(no prior collections — full creative freedom)"
      : history
          .map((c) => {
            const sample = c.sampleItems.slice(0, 5).join(", ");
            return `- "${c.name}"${sample ? ` — e.g. ${sample}` : ""}`;
          })
          .join("\n");

  return `You are a movie/TV curator. Given a list of items from a Plex "${sectionTitle}" library, create curated themed collections.

Rules:
- Create exactly ${limit} collections.
${args.fill === "recommender" ? SEED_RULES : listRules(minItems, maxItems)}- Only use titles that exactly match the input list.
- Collection names must be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format).
- Be surprising and inventive — avoid obvious genre or decade groupings.
${vibeLine ? `- ${vibeLine}\n` : ""}${nameLine ? `- ${nameLine}\n` : ""}
${themesBlock}

Previously generated collections for this library (DO NOT repeat these themes, names, or produce collections whose roster would substantially overlap with these):
${historyBlock}

Your new collections must explore different angles than anything above.
${args.taken ? takenBlock(args.taken) : ""}${prefsBlock}
Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]`;
}

const takenBlock = (taken: { names: string[]; titles: string[] }) => `
This run already has these collections; yours must be about something else entirely: ${taken.names.map((n) => `"${n}"`).join(", ")}.
These titles are already taken — do NOT use any of them: ${taken.titles.join("; ")}.
`;

const listRules = (
  minItems: number,
  maxItems: number,
) => `- Each collection MUST have between ${minItems} and ${maxItems} items, no fewer than ${minItems}.
- List each title at most once within a collection.
- Each collection needs its own theme and its own roster: an item can appear in more than one collection, but no two collections may share more than a few items.
`;

/**
 * The model names the theme and its clearest examples; a recommender adds the
 * rest. Distinct examples matter more than anything else here — two themes
 * seeded alike are filled alike.
 */
const SEED_RULES = `- For each collection, list only the 3 to 5 titles that best define its theme. Similar titles from the library are added to it automatically, so pick examples that clearly share the theme.
- Never use the same title in two collections; each collection needs a theme clearly different from the others.
`;

/**
 * Sample up to `n` distinct items uniformly without replacement. Used to
 * record a representative sliver of each generated collection in rule
 * history so the next prompt can avoid retreading the same ground.
 */
export function pickSampleItems(titles: string[], n = 5): string[] {
  if (titles.length <= n) return [...titles];
  const copy = [...titles];
  const out: string[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
