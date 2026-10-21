import type { PlexClient, PlexSection } from "@rube/plex";
import type { JobContext, UserPreferences } from "@rube/core";
import type { Rule } from "@rube/domain.rules";
import type { RuleConfig } from "./config.ts";

/**
 * One collection a handler wants to materialize. Handlers yield these as
 * they're computed; orchestration decides whether to commit them to Plex
 * (run mode) or convert them to a preview (test mode).
 */
export interface PendingCollection {
  name: string;
  section: PlexSection;
  matched: Array<{ ratingKey: string; title: string; year?: number }>;
  /**
   * Sample items for ai_prompt history. Only set by the AI handler.
   * Lives on the pending collection rather than a separate channel so
   * a single dispatch loop covers all rule types.
   */
  matchedTitles?: string[];
  /**
   * A description the source published for this exact collection. Only
   * `tmdb_franchises` has one — TMDb writes an overview per franchise, and its
   * prose beats anything a template would assemble from the name.
   */
  sourceSummary?: string;
}

export interface HandlerDeps {
  ctx: JobContext;
  client: PlexClient;
  sections: PlexSection[];
  rule: Rule;
  ruleConfig: RuleConfig;
  /**
   * Notified after every AI call. Optional — only the ai_prompt handler
   * uses it, and only the preview path currently consumes the totals.
   */
  onAiUsage?: (tokensIn: number, tokensOut: number) => void;
  /**
   * Set by the Test/preview path. Only read to attribute LLM usage: a preview
   * spends real tokens, but "what did testing cost" and "what does the nightly
   * run cost" are different questions in Settings → AI.
   */
  preview?: true;
  /**
   * Set only during a per-user personalize run — the preferences of the user
   * this generation pass is for. Handlers use it to steer/filter output.
   */
  userPrefs?: UserPreferences;
  /**
   * The `rule_runs.id` this dispatch belongs to, when there is one, so each
   * committed collection's membership diff can be attributed to a run.
   *
   * Passed explicitly rather than read off `ctx.runId`, which means the *job*
   * run — a rule run inside the nightly batch has both, and conflating them
   * would file every rule's changes under the job.
   *
   * Absent for previews and the personalize pass, which record no changeset.
   */
  ruleRunId?: string;
}

export type Handler = (deps: HandlerDeps) => AsyncGenerator<PendingCollection>;
