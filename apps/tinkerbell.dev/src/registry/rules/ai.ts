/**
 * AI-curated rules. Each one is a themed prompt for the `ai_prompt` handler,
 * which asks the configured LLM to name collections and pick titles from the
 * library it's pointed at.
 *
 * `themes` values are drawn from the wizard's `PRESET_THEMES` list so an
 * imported rule opens cleanly in the editor with its chips already selected;
 * anything bespoke goes in `customThemes`.
 *
 * All of these need an LLM provider configured (Settings → AI), declared via
 * `requires: ["llm"]` on the rule type.
 */
import type { RegistryRuleInput } from "@tinkerbell/contracts";

export const AI_RULES: RegistryRuleInput[] = [
  {
    slug: "picked-for-you",
    name: "Picked For You",
    description:
      "A personalized shelf per opted-in user, shaped by their stated tastes. Requires Personalized Home Screens.",
    type: "ai_prompt",
    config: {
      themes: ["Vibes & tone", "Moods & atmospheres", "Unexpected pairings"],
      customThemes: [],
      vibe: "mixed",
      nameStyle: "short_punchy",
      limit: 6,
      minItems: 12,
      personalizable: true,
      pinToHomepage: false,
      presentation: { summary: "llm", poster: "mosaic" },
    },
  },
  {
    slug: "sunday-afternoon",
    name: "Sunday Afternoon",
    description: "Low-stakes, everyone-in-the-room picks. Playful names, nothing demanding.",
    type: "ai_prompt",
    config: {
      themes: ["Vibes & tone", "Moods & atmospheres"],
      customThemes: ["Comfort watches", "Rainy afternoon films"],
      vibe: "playful",
      nameStyle: "short_punchy",
      limit: 5,
      minItems: 12,
      pinToHomepage: false,
      presentation: { summary: "llm", poster: "mosaic" },
    },
  },
  {
    slug: "unexpected-pairings",
    name: "Unexpected Pairings",
    description: "The rule that earns its keep — collections nobody would think to build by hand.",
    type: "ai_prompt",
    config: {
      themes: ["Unexpected pairings", "Narrative parallels", "Hidden gems"],
      customThemes: [],
      vibe: "playful",
      nameStyle: "short_punchy",
      limit: 8,
      minItems: 10,
      pinToHomepage: false,
      presentation: { summary: "llm", poster: "mosaic" },
    },
  },
  {
    slug: "spooky-ai",
    name: "Nights Drawing In",
    description: "Horror curation by mood rather than subgenre — dread, folk unease, creature features.",
    type: "ai_prompt",
    config: {
      themes: ["Moods & atmospheres", "Subgenres", "Visual style & cinematography"],
      customThemes: ["Slow-burn dread", "Practical-effects showcases"],
      vibe: "serious",
      nameStyle: "short_punchy",
      limit: 6,
      minItems: 10,
      pinToHomepage: false,
      presentation: { summary: "llm", poster: "mosaic", accentColor: "#B3261E" },
    },
  },
  {
    slug: "international-acclaim",
    name: "International Acclaim",
    description: "World cinema grouped by movement, era, and national tradition rather than by country code.",
    type: "ai_prompt",
    config: {
      themes: ["Directors & auteurs", "Decades & eras", "Visual style & cinematography"],
      customThemes: ["National cinema movements"],
      vibe: "serious",
      nameStyle: "descriptive",
      limit: 6,
      minItems: 10,
      pinToHomepage: false,
      presentation: { summary: "llm", poster: "mosaic" },
    },
  },
];
