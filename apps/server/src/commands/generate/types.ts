import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import type { JobContext } from "@tinkerbell/core";
import type { Rule } from "#domains/rules.ts";
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
}

export type Handler = (deps: HandlerDeps) => AsyncGenerator<PendingCollection>;
