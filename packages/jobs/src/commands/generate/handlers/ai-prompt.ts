import { getRecentHistory } from "@tinkerbell/domain.rule-history";
import { buildAiPrompt, pickSampleItems } from "#commands/generate/ai/prompt.ts";
import { parseAiCollections } from "#commands/generate/ai/parse.ts";
import { askLlm, shuffled } from "#commands/generate/ai/llm.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

export async function* aiPromptHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
  const { ctx, client, sections, rule, ruleConfig, onAiUsage, userPrefs } = deps;

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

    const itemList = shuffled(items)
      .map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`)
      .join("\n");

    ctx.log(`Asking the LLM for curated collections...`);
    const { text, tokensIn, tokensOut } = await askLlm(prompt, itemList, ctx.signal);
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

// Re-exported so the dispatch loop can call askLlm → parse to also
// surface token usage in preview without re-implementing the handler.
export { askLlm } from "#commands/generate/ai/llm.ts";
export { parseAiCollections } from "#commands/generate/ai/parse.ts";
export { buildAiPrompt } from "#commands/generate/ai/prompt.ts";
