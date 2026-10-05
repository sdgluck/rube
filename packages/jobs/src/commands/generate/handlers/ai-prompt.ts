import { type Services } from "@tinkerbell/composition";
import { createLlmCommand } from "../ai/llm.ts";

import { buildAiPrompt, pickSampleItems } from "#commands/generate/ai/prompt.ts";
import { parseAiCollections } from "#commands/generate/ai/parse.ts";
import { shuffled, MAX_ITEMS_PER_CALL } from "#commands/generate/ai/llm.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

// `askLlm` is returned by this handler's factory rather than re-exported: it
// reads the configured provider, so it is built with the run's dependencies.
export { parseAiCollections } from "#commands/generate/ai/parse.ts";
export { buildAiPrompt } from "#commands/generate/ai/prompt.ts";

export function createAiPromptCommand(deps: Services) {
  const { ruleHistory } = deps;
  const { getRecentHistory } = ruleHistory;
  const { askLlm } = createLlmCommand(deps);

  async function* aiPromptHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, rule, ruleConfig, onAiUsage, userPrefs, preview } = deps;

    const maxCollections = ruleConfig.limit ?? 8;
    const minItems = ruleConfig.minItems ?? 15;
    const themes = ruleConfig.themes ?? [];
    const customThemes = ruleConfig.customThemes ?? [];

    if (maxCollections > 10) throw new Error("Limit cannot exceed 10.");

    for (const section of sections) {
      ctx.log(`[AI Prompt] "${section.title}" — starting...`);

      ctx.log(`Fetching library items...`);
      const items = await client.fetchAllItems(section.key);
      ctx.log(`Found ${items.length} item(s).`);

      if (items.length < 10) {
        ctx.log(`Too few items to generate collections, skipping.`);
        continue;
      }

      const history = getRecentHistory(rule.id, section.key);
      if (history.length > 0) {
        ctx.log(`Loaded ${history.length} prior collection(s) from history to inform prompt.`);
      }

      const prompt = buildAiPrompt({
        sectionTitle: section.title,
        limit: maxCollections,
        minItems,
        themes,
        customThemes,
        vibe: ruleConfig.vibe,
        nameStyle: ruleConfig.nameStyle,
        history,
        preferences: userPrefs,
      });

      // The LLM call caps its payload at MAX_ITEMS_PER_CALL titles (a security
      // bound on blast radius — see llm.ts). For libraries larger than that we
      // send a random sample rather than failing the whole rule. The shuffle
      // reseeds every run, so different titles surface over time, and combined
      // with the rule-history mechanism that turns the partial view into
      // variety rather than a blind spot. Matching below still runs against the
      // full library, so the model can name any sampled title.
      const sample = shuffled(items).slice(0, MAX_ITEMS_PER_CALL);
      if (items.length > MAX_ITEMS_PER_CALL) {
        ctx.log(`Library has ${items.length} items; sampling ${MAX_ITEMS_PER_CALL} this run (LLM cap).`);
      }
      // Collapse any newlines in a title to a space so each item stays exactly
      // one line: the cap is enforced as a line count, and a title with an
      // embedded newline (arbitrary Plex names are user-controlled) would both
      // re-trip that cap and corrupt the line-delimited format we parse back.
      const itemList = sample
        .map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`.replace(/[\r\n]+/g, " "))
        .join("\n");

      ctx.log(`Asking the LLM for curated collections...`);
      const { text, tokensIn, tokensOut } = await askLlm(prompt, itemList, {
        signal: ctx.signal,
        ruleId: rule.id,
        feature: preview ? "rule-preview" : "rule",
      });
      onAiUsage?.(tokensIn, tokensOut);
      ctx.log("AI response:", text);

      const aiCollections = parseAiCollections(text);
      ctx.log(`Got ${aiCollections.length} collection(s) from AI.`);

      // Build a title→item map. Both "Title (Year)" and bare "Title" forms
      // map to the same item so we tolerate either shape from the model.
      const titleMap = new Map<string, { ratingKey: string; title: string; year?: number }>();
      for (const item of items) {
        const info = { ratingKey: item.ratingKey, title: item.title, year: item.year };
        titleMap.set(`${item.title}${item.year ? ` (${item.year})` : ""}`, info);
        titleMap.set(item.title, info);
      }

      for (const col of aiCollections) {
        const matched = col.items
          .map((title) => titleMap.get(title))
          .filter((m): m is { ratingKey: string; title: string; year?: number } => m !== undefined);

        if (matched.length < minItems) {
          ctx.log(`Skipping "${col.name}" — only ${matched.length} matching item(s), need at least ${minItems}`);
          continue;
        }

        const matchedTitles = matched.map((m) => `${m.title}${m.year ? ` (${m.year})` : ""}`);
        yield {
          name: col.name,
          section,
          matched,
          matchedTitles: pickSampleItems(matchedTitles),
        };
      }
    }
  }

  return { askLlm, aiPromptHandler };
}
