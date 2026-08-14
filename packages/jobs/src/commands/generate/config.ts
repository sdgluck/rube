import { ruleConfigSchema, type RuleConfig } from "@tinkerbell/contracts";
import type { Rule } from "@tinkerbell/domain.rules";

// The schema itself lives in `@tinkerbell/contracts` so the admin UI and the
// registry build validate against the same definition the job parses with.
// Re-exported here because every server-side call site already imports it
// from this module.
export { ruleConfigSchema };
export type { RuleConfig };

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
