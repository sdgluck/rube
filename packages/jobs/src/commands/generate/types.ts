import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import type { JobContext, UserPreferences } from "@tinkerbell/core";
import type { Rule } from "@tinkerbell/domain.rules";
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
   * Set only during a per-user personalize run — the preferences of the user
   * this generation pass is for. Handlers use it to steer/filter output.
   */
  userPrefs?: UserPreferences;
}

export type Handler = (deps: HandlerDeps) => AsyncGenerator<PendingCollection>;
