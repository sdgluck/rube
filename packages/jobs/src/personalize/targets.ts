/**
 * Which users and rules a Personalized Collections run covers, and clearing
 * out what it no longer covers.
 *
 * Targeting narrows; it never widens. A named user who hasn't opted in through
 * the portal is skipped — the opt-in is their consent to a per-user home, and a
 * setting on the admin's side can't stand in for it.
 *
 * Narrowing has to delete as well as skip. Collections are only rebuilt (and
 * so only replaced) for pairs in the target, so without a sweep a user dropped
 * from the target keeps last week's rows pinned to their home forever.
 */
import type { PlexClient, PlexSection } from "@tinkerbell/plex";
import type { JobContext, PersonalizeJobConfig } from "@tinkerbell/core";
import { BASELINE_LABEL } from "./reconcile.ts";

export type Targets<U, R> = {
  users: U[];
  rules: R[];
  /** Named in the target but not opted in, so skipped. */
  notOptedIn: string[];
  /** Named in the target but not an enabled personalizable rule. */
  unknownRules: string[];
};

export function selectTargets<U extends { username: string }, R extends { id: string }>(
  optedIn: U[],
  personalizable: R[],
  config: Pick<PersonalizeJobConfig, "users" | "ruleIds">,
): Targets<U, R> {
  const wantedUsers = config.users?.length ? new Set(config.users.map((u) => u.toLowerCase())) : null;
  const wantedRules = config.ruleIds?.length ? new Set(config.ruleIds) : null;
  const optedInNames = new Set(optedIn.map((u) => u.username.toLowerCase()));
  const ruleIds = new Set(personalizable.map((r) => r.id));
  return {
    users: wantedUsers ? optedIn.filter((u) => wantedUsers.has(u.username.toLowerCase())) : optedIn,
    rules: wantedRules ? personalizable.filter((r) => wantedRules.has(r.id)) : personalizable,
    notOptedIn: (config.users ?? []).filter((u) => !optedInNames.has(u.toLowerCase())),
    unknownRules: (config.ruleIds ?? []).filter((id) => !ruleIds.has(id)),
  };
}

export type TargetScope = {
  /** Every opted-in username, lowercased. */
  optedIn: Set<string>;
  /** Every enabled personalizable rule id. */
  personalizable: Set<string>;
  targetUsers: Set<string>;
  targetRules: Set<string>;
};

/**
 * Is this a collection this job made, for a user and rule it still knows about
 * but no longer targets? Deliberately narrow: it has to carry the baseline
 * label, a `User:` label for an opted-in user and a `Rule:` label for a
 * personalizable rule — so Because You Watched's per-user collections, which
 * carry no rule label, and anything an admin made by hand are never matched.
 */
export function isOutOfTarget(labels: string[], scope: TargetScope): boolean {
  if (!labels.includes(BASELINE_LABEL)) return false;
  const user = labels
    .find((l) => l.startsWith("User:"))
    ?.slice("User:".length)
    .toLowerCase();
  const rule = labels.find((l) => l.startsWith("Rule:"))?.slice("Rule:".length);
  if (!user || !rule) return false;
  if (!scope.optedIn.has(user) || !scope.personalizable.has(rule)) return false;
  return !scope.targetUsers.has(user) || !scope.targetRules.has(rule);
}

/** Whether the target leaves anything out, i.e. whether a sweep can find anything. */
export function isNarrowed(scope: TargetScope): boolean {
  return scope.targetUsers.size < scope.optedIn.size || scope.targetRules.size < scope.personalizable.size;
}

/** Delete the collections `isOutOfTarget` matches, logging each one. Returns their keys. */
export async function removeOutOfTarget(
  client: Pick<PlexClient, "getCollectionsWithLabels" | "deleteItem">,
  sections: PlexSection[],
  scope: TargetScope,
  ctx: Pick<JobContext, "log">,
): Promise<string[]> {
  const removed: string[] = [];
  for (const section of sections) {
    const collections = await client.getCollectionsWithLabels(section.key, { label: BASELINE_LABEL });
    for (const col of collections) {
      if (!isOutOfTarget(col.labels, scope)) continue;
      await client.deleteItem(col.ratingKey);
      removed.push(col.ratingKey);
      ctx.log(`Removed "${col.title}" — its user or rule is no longer targeted.`);
    }
  }
  return removed;
}
