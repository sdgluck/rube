/**
 * Events a rule run announces about the *library*, as opposed to the ones the
 * job runner announces about itself.
 *
 * Both are transition-shaped rather than state-shaped: "this collection is new
 * tonight", "this rule stopped matching". A run that produces the same output
 * as last night has nothing to say, and saying it anyway is how a channel gets
 * muted.
 */
import { emitEvent } from "@tinkerbell/domain.events";

/** How many names to list before "and N more". */
const SAMPLE_SIZE = 5;

function sampleList(names: string[]): string {
  const sample = names.slice(0, SAMPLE_SIZE);
  const more = names.length - sample.length;
  return more > 0 ? `${sample.join(", ")} and ${more} more` : sample.join(", ");
}

/**
 * Announce the collections a run created that weren't there before it.
 *
 * `before` and `after` are the rule's collection titles from the local mirror,
 * read either side of the run. The diff is what makes this mean "the engine
 * found something new" rather than "the engine ran" — which mattered acutely
 * when a run deleted and recreated everything it owned, and still holds now
 * that a run reconciles instead.
 */
export function announceNewCollections(ruleId: string, ruleName: string, before: string[], after: string[]): void {
  const known = new Set(before);
  const fresh = after.filter((title) => !known.has(title));
  if (fresh.length === 0) return;

  emitEvent("collection.created", `"${ruleName}" created ${fresh.length} new collection(s): ${sampleList(fresh)}`, {
    ruleId,
    ruleName,
    count: fresh.length,
    titles: fresh.slice(0, SAMPLE_SIZE),
  });
}

/**
 * Announce a rule that used to match items and no longer does.
 *
 * Only on the transition. A rule that has matched nothing for a month is a
 * rule the user has already been told about, and repeating it every night
 * turns the one useful signal into background noise.
 *
 * `previousItemCount` is the rule's `lastRunItemCount` as it stood *before*
 * this run wrote its own — so this must be called with a value captured
 * before `setRuleLastRun`.
 */
export function announceEmptyRule(
  ruleId: string,
  ruleName: string,
  previousItemCount: number | null,
  itemCount: number,
  /**
   * The run this happened on, so the notification can link to the funnel that
   * is about to be written onto it. Optional only because a run isn't always
   * tracked; when it is, this is the whole difference between "your rule broke"
   * and "your rule broke, and here is the clause that did it".
   */
  ruleRunId?: string | null,
): void {
  if (itemCount !== 0) return;
  if (previousItemCount == null || previousItemCount <= 0) return;

  emitEvent(
    "rule.empty",
    `"${ruleName}" matched nothing this run — it matched ${previousItemCount} item(s) last time`,
    { ruleId, ruleName, previousItemCount, ...(ruleRunId ? { ruleRunId } : {}) },
  );
}
