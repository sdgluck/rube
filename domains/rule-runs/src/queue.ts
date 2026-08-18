import type { RuleRunsDeps } from "./index.ts";
import { perDeps } from "@tinkerbell/container";
/**
 * Serialises manual rule runs inside this process.
 *
 * Two runs of the same rule at once produce duplicate Plex collections (each
 * deletes the rule's collections before either creates), and a bulk "run all"
 * firing twenty rules at one Plex server at once is antisocial regardless. The
 * router used to get the first property from an abort-and-await dance over a
 * `Map` of in-flight promises; a queue does it more plainly, and — because the
 * waiting runs already have `queued` rows — visibly.
 *
 * Cross-rule mutual exclusion against the Generate job is a different problem
 * with a different answer: the `rule_locks` lease, which works across processes.
 */

export const createRuleRunQueue = perDeps(function createRuleRunQueue(_deps: RuleRunsDeps) {
  let chain: Promise<unknown> = Promise.resolve();

  /** Run `task` after everything already queued has settled, pass or fail. */
  function queueRuleRun<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task, task);
    // The chain must never reject, or every later task would inherit the
    // rejection and skip its turn.
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** How many runs are waiting or executing. Diagnostics and tests only. */
  function queueIsIdle(): Promise<void> {
    return chain.then(
      () => {},
      () => {},
    );
  }

  return { queueRuleRun, queueIsIdle };
});
