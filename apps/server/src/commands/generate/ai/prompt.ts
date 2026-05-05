import type { HistoricalCollection } from "#domains/rule-history.ts";
import { VIBE_HINTS, NAME_STYLE_HINTS, type RuleConfig } from "#commands/generate/config.ts";

export function buildAiPrompt(args: {
  sectionTitle: string;
  limit: number;
  minItems: number;
  themes: string[];
  customThemes: string[];
  vibe?: RuleConfig["vibe"];
  nameStyle?: RuleConfig["nameStyle"];
  history: HistoricalCollection[];
}): string {
  const { sectionTitle, limit, minItems, themes, customThemes, vibe, nameStyle, history } = args;

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
- Each collection MUST have between ${minItems} and 30 items, no fewer than ${minItems}.
- Each item can appear in multiple collections.
- Only use titles that exactly match the input list.
- Collection names must be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format).
- Be surprising and inventive — avoid obvious genre or decade groupings.
${vibeLine ? `- ${vibeLine}\n` : ""}${nameLine ? `- ${nameLine}\n` : ""}
${themesBlock}

Previously generated collections for this library (DO NOT repeat these themes, names, or produce collections whose roster would substantially overlap with these):
${historyBlock}

Your new collections must explore different angles than anything above.

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]`;
}

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
