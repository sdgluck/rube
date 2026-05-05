import { z } from "zod";
import { smartFilterGroupSchema } from "@tinkerbell/plex-smart-filter";
import type { Rule } from "@tinkerbell/domain.rules";

export const ruleConfigSchema = z.object({
  prompt: z.string().optional(),
  themes: z.array(z.string()).optional(),
  customThemes: z.array(z.string()).optional(),
  vibe: z.enum(["playful", "serious", "mixed"]).optional(),
  nameStyle: z.enum(["short_punchy", "descriptive"]).optional(),
  limit: z.number().optional(),
  minItems: z.number().optional(),
  sections: z.array(z.string()).optional(),
  chart: z.string().optional(),
  listId: z.string().optional(),
  /** list_source: which external list provider supplies the items. */
  listProvider: z.enum(["mdblist", "trakt", "imdb"]).optional(),
  /** list_source / smart_filter: optional override for the generated collection name. */
  collectionName: z.string().optional(),
  /**
   * smart_filter: recursive boolean tree of clauses translated to a Plex
   * query string at run time. AND/OR groups can nest arbitrarily so any
   * Plex smart-collection filter (including OR-within-field via repeated
   * equality and OR groups via push/or/pop) round-trips cleanly.
   */
  smartFilter: smartFilterGroupSchema.optional(),
  /** seerr-requests: status filter ("all" / "approved" / "pending" / …). */
  filter: z.string().optional(),
  pinToHomepage: z.boolean().optional(),
  arr: z
    .object({
      enabled: z.boolean(),
      monitor: z.boolean(),
      searchOnAdd: z.boolean(),
      qualityProfileId: z.number(),
      rootFolderPath: z.string(),
      maxAddsPerRun: z.number(),
      dryRun: z.boolean(),
    })
    .optional(),
});

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export const VIBE_HINTS: Record<NonNullable<RuleConfig["vibe"]>, string> = {
  playful: "Playful, witty, irreverent — names can be cheeky.",
  serious: "Serious and considered — names should feel curated and adult.",
  mixed: "Mix playful and serious tones across the set.",
};

export const NAME_STYLE_HINTS: Record<NonNullable<RuleConfig["nameStyle"]>, string> = {
  short_punchy: "Names should be short and punchy (1–4 words).",
  descriptive: "Names can be a bit longer and descriptive (up to ~6 words).",
};

export function parseRuleConfig(rule: Rule): RuleConfig {
  const parsed = ruleConfigSchema.safeParse(rule.config ?? {});
  if (!parsed.success) {
    console.warn(`[generate] rule "${rule.name}" has invalid config:`, parsed.error.message);
    return {};
  }
  return parsed.data;
}
