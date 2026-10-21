/**
 * Writes a previewed plan to the rules table.
 *
 * Runs inline in the tRPC mutation rather than as a background job. The
 * migrate-collections job exists because it deletes Plex collections and can
 * take minutes; this does a handful of inserts against local SQLite, so a job
 * would add a pending-plan config slot and a single-writer handoff to protect
 * work that finishes in milliseconds.
 */
import { type Rule, type Rules } from "@rube/domain.rules";
import type { ImportPlan } from "@rube/contracts";
import { hashConfig } from "./hash.ts";

export interface ImportOptions {
  /** Default false. Registry content is remote — nothing should touch Plex
   *  until the user has looked at what landed. */
  enabled?: boolean;
}

export interface ImportDeps {
  rules: Rules;
}
export function createImport(deps: ImportDeps) {
  const { createRule } = deps.rules;

  function importPlan(plan: ImportPlan, opts: ImportOptions = {}): Rule[] {
    const created: Rule[] = [];
    for (const item of plan.items) {
      created.push(
        createRule({
          name: item.name,
          type: item.rule.type,
          config: item.config,
          enabled: opts.enabled === true,
          registryRuleSlug: item.rule.slug,
          registryPackSlug: plan.packSlug,
          // Pack version, not rule version — rules have no version of their own,
          // and it's the pack the user chose to track.
          registryVersion: plan.packVersion,
          // Hash the config *as written*, post-resolution. Hashing the published
          // config instead would mark every imported rule as locally modified
          // the moment resolution rewrote a tag value.
          registryConfigHash: hashConfig(item.config),
        }),
      );
    }
    return created;
  }

  return { importPlan };
}
