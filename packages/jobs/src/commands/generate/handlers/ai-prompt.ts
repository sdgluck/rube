import { type Services } from "@tinkerbell/composition";
import { describeSkip } from "@tinkerbell/domain.recommendations";
import { createLlmCommand } from "../ai/llm.ts";

import { buildAiPrompt, pickSampleItems } from "#commands/generate/ai/prompt.ts";
import { parseAiCollections, type AiCollection } from "#commands/generate/ai/parse.ts";
import { selectCollections, type MatchedItem, type Verdict } from "#commands/generate/ai/select.ts";
import { fillFromSeeds, MIN_COHESION, MIN_SEEDS, type Filled } from "#commands/generate/ai/fill.ts";
import { shuffled, MAX_ITEMS_PER_CALL } from "#commands/generate/ai/llm.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

// `askLlm` is returned by this handler's factory rather than re-exported: it
// reads the configured provider, so it is built with the run's dependencies.
export { parseAiCollections } from "#commands/generate/ai/parse.ts";
export { buildAiPrompt } from "#commands/generate/ai/prompt.ts";

/**
 * Extra calls for themes when too few of the first answer survive. Each takes
 * about as long as the first (it re-reads the library list), so two bound a
 * run at roughly three times the old one.
 */
const MAX_TOP_UPS = 2;

export function createAiPromptCommand(deps: Services) {
  const { ruleHistory, recommendations } = deps;
  const { getRecentHistory } = ruleHistory;
  const { askLlm } = createLlmCommand(deps);

  async function* aiPromptHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, rule, ruleConfig, onAiUsage, userPrefs, preview } = deps;

    const maxCollections = ruleConfig.limit ?? 8;
    const minItems = ruleConfig.minItems ?? 15;
    const maxItems = Math.max(ruleConfig.maxItems ?? 30, minItems);
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

      // Checked before the prompt is written: the two modes ask the model for
      // different things, so finding out after the call would waste it.
      let fill = ruleConfig.aiFill ?? "llm";
      if (fill === "recommender") {
        const coverage = recommendations.coverage(items.map((i) => i.ratingKey));
        if ("skipped" in coverage) {
          ctx.log(
            `The recommender can't fill these collections — ${describeSkip(coverage)}. The AI model picks every title instead.`,
          );
          fill = "llm";
        } else {
          ctx.log(`The recommender fills each theme (it knows ${coverage.withVector} of ${coverage.total} titles).`);
        }
      }

      const history = getRecentHistory(rule.id, section.key);
      if (history.length > 0) {
        ctx.log(`Loaded ${history.length} prior collection(s) from history to inform prompt.`);
      }

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

      // Build a title→item map. Both "Title (Year)" and bare "Title" forms
      // map to the same item so we tolerate either shape from the model.
      const titleMap = new Map<string, MatchedItem>();
      for (const item of items) {
        const info = { ratingKey: item.ratingKey, title: item.title, year: item.year };
        titleMap.set(`${item.title}${item.year ? ` (${item.year})` : ""}`, info);
        titleMap.set(item.title, info);
      }
      const library = items.map((i) => ({ ratingKey: i.ratingKey, title: i.title, year: i.year }));

      // Every theme the model has offered this run, across calls. Each call's
      // themes are judged together with the earlier ones — re-filling from the
      // start is cheap and keeps "an example counts once" true across calls.
      const asked: AiCollection[] = [];
      let verdicts: Verdict<MatchedItem>[] = [];
      for (let call = 0; ; call++) {
        const kept = verdicts.filter((v) => v.kind === "keep").length;
        const want = maxCollections - kept;
        const prompt = buildAiPrompt({
          sectionTitle: section.title,
          limit: want,
          minItems,
          maxItems,
          fill,
          themes,
          customThemes,
          vibe: ruleConfig.vibe,
          nameStyle: ruleConfig.nameStyle,
          history,
          preferences: userPrefs,
          taken:
            call === 0
              ? undefined
              : { names: asked.map((c) => c.name), titles: [...new Set(asked.flatMap((c) => c.items))] },
        });

        ctx.log(call === 0 ? `Asking the LLM for curated collections...` : `Asking the LLM for ${want} more...`);
        const { text, tokensIn, tokensOut } = await askLlm(prompt, itemList, {
          signal: ctx.signal,
          ruleId: rule.id,
          feature: preview ? "rule-preview" : "rule",
        });
        onAiUsage?.(tokensIn, tokensOut);
        ctx.log("AI response:", text);

        const fresh = parseAiCollections(text);
        ctx.log(`Got ${fresh.length} collection(s) from AI.`);
        const before = asked.length;
        asked.push(...fresh);

        let candidates = asked.map((col) => ({
          name: col.name,
          matched: col.items.map((title) => titleMap.get(title)).filter((m) => m !== undefined),
        }));
        if (fill === "recommender") {
          const filled = fillFromSeeds(
            candidates,
            library,
            maxItems,
            recommendations.nearest,
            recommendations.cohesion,
          );
          for (const c of filled.slice(before)) ctx.log(`"${c.name}": ${describeFill(c)}`);
          candidates = filled.filter((c) => !c.dropped);
        }
        verdicts = selectCollections(candidates, minItems, maxItems);

        // Only the recommender mode tops up: its calls ask for a few titles
        // each and return in a minute or two, where a full LLM-picked list
        // is the slow, expensive call this mode exists to avoid. And a small
        // model there gives two or three usable themes in ten.
        const nowKept = verdicts.filter((v) => v.kind === "keep").length;
        if (fill !== "recommender" || nowKept >= maxCollections || call >= MAX_TOP_UPS) break;
        ctx.log(`${nowKept} of ${maxCollections} theme(s) usable so far.`);
      }

      let yielded = 0;
      for (const verdict of verdicts) {
        if (verdict.kind === "too-few") {
          ctx.log(
            `Skipping "${verdict.name}" — only ${verdict.distinct} distinct matching item(s), need at least ${minItems}`,
          );
          continue;
        }
        if (verdict.kind === "duplicate") {
          ctx.log(`Skipping "${verdict.name}" — ${verdict.shared} of its items are already in "${verdict.of}"`);
          continue;
        }
        // A top-up asked for the shortfall, but a model may answer with more.
        if (yielded === maxCollections) break;
        yielded++;
        const { matched } = verdict;
        const matchedTitles = matched.map((m) => `${m.title}${m.year ? ` (${m.year})` : ""}`);
        yield {
          name: verdict.name,
          section,
          matched,
          matchedTitles: pickSampleItems(matchedTitles),
        };
      }
    }
  }

  return { askLlm, aiPromptHandler };
}

/** One run-log line per theme in recommender mode: what was filled, or why not. */
function describeFill(c: Filled<MatchedItem>): string {
  if (c.dropped?.reason === "examples") {
    const reused = c.dropped.reused > 0 ? ` (${c.dropped.reused} already used by an earlier theme)` : "";
    return `skipped — ${c.dropped.fresh} usable example(s)${reused}, needs ${MIN_SEEDS}.`;
  }
  if (c.dropped?.reason === "scattered") {
    return `skipped — its examples have too little in common (${c.dropped.cohesion.toFixed(2)}, needs ${MIN_COHESION}).`;
  }
  if (c.skipped) {
    const why =
      c.skipped.skipped === "seed-has-no-vector"
        ? "the recommender knows none of its examples"
        : describeSkip(c.skipped);
    return `not filled — ${why}.`;
  }
  return `${c.seeds} example(s) from the AI, ${c.matched.length - c.seeds} added by the recommender.`;
}
