import { type Services } from "@tinkerbell/composition";
import { createFunnelCommand } from "./funnel.ts";
/**
 * Explaining a real run that produced nothing.
 *
 * The funnel already existed, but only during a *test* — press Test, read the
 * waterfall, fix the clause. That is the good path and it is not the one that
 * hurts: the run that matters is the nightly one, where a rule that used to
 * match 34 films now matches none, the `rule.empty` notification arrives at
 * 1am, and by the time anyone reads it the only thing they can do is press
 * Test and hope the library still looks the way it did last night.
 *
 * So a real run that comes back empty now measures itself, once, and stores
 * the answer on the run row. Deliberately not on every run: it costs one Plex
 * count per clause per section, which is nothing when it explains a zero and
 * minutes of counting a night when it explains that a rule worked.
 */

import { errorMessage, type JobContext } from "@tinkerbell/core";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

import type { RuleConfig } from "@tinkerbell/contracts";

export interface DiagnoseOptions {
  ctx: JobContext;
  client: PlexClient;
  sections: PlexSection[];
  ruleType: string;
  ruleConfig: RuleConfig;
  /** Null when the run wasn't tracked — nothing to attach a diagnosis to. */
  ruleRunId: string | null | undefined;
  itemCount: number;
}

export function createDiagnoseCommand(deps: Services) {
  const { ruleRuns } = deps;
  const { setRuleRunFunnel } = ruleRuns;
  const { buildFilterFunnel } = createFunnelCommand(deps);

  /**
   * Measure and store the funnel, if this run is one worth explaining.
   *
   * Never throws. Every caller is on the success path of a run that has already
   * finished and already committed; a diagnosis that fails is a missing
   * explanation, not a failed run.
   */
  async function diagnoseEmptyRun(opts: DiagnoseOptions): Promise<void> {
    const { ctx, client, sections, ruleType, ruleConfig, ruleRunId, itemCount } = opts;
    if (itemCount !== 0 || !ruleRunId) return;
    // Only smart filters narrow. Every other rule type selects from a source —
    // an IMDb chart, an Overseerr feed — so "which clause emptied it" is not a
    // question that has an answer.
    if (ruleType !== "smart_filter" || !ruleConfig.smartFilter?.children.length) return;

    try {
      ctx.log("Matched nothing — measuring where the items went, clause by clause…");
      const funnel = await buildFilterFunnel({ ctx, client, sections, filter: ruleConfig.smartFilter });
      if (funnel.length === 0) return;
      for (const section of funnel) {
        const trail = section.steps.map((s) => `${s.label} → ${s.remaining}`).join("; ");
        ctx.log(`[Funnel] "${section.sectionTitle}": ${section.start} → ${trail || "no clauses"} → ${section.final}`);
      }
      setRuleRunFunnel(ruleRunId, funnel);
    } catch (err) {
      ctx.log(`Couldn't work out where the items went: ${errorMessage(err)}`);
    }
  }

  return { diagnoseEmptyRun };
}
