/**
 * Detects registry-linked rules whose pack has published a newer version.
 *
 * Updates are always offered, never applied automatically: a registry bump is
 * remote content changing what runs against somebody's Plex server, which is
 * not something to do behind their back. Rules whose config has been edited
 * locally are reported with `locallyModified` set and are excluded from any
 * bulk apply — the user's own edits outrank ours.
 */
import { getRules, updateRule, type Rule } from "@tinkerbell/domain.rules";
import type { RegistryUpdate } from "@tinkerbell/contracts";
import { getRegistry } from "./fetch.ts";
import { hashConfig } from "./hash.ts";
import { carryOverUserChoices } from "./overrides.ts";
import { resolveRuleForImport, type ResolveTarget, type TagLookup } from "./resolve.ts";

function linkedRules(): Rule[] {
  return getRules().filter((r) => !!r.registryRuleSlug);
}

export async function checkForUpdates(): Promise<RegistryUpdate[]> {
  const { packsBySlug, rulesBySlug } = await getRegistry();
  const updates: RegistryUpdate[] = [];

  for (const rule of linkedRules()) {
    const slug = rule.registryRuleSlug!;
    // A rule whose registry entry has since been removed isn't an update —
    // it's just a rule the user owns now. Nothing to say about it.
    if (!rulesBySlug.has(slug)) continue;

    const pack = rule.registryPackSlug ? packsBySlug.get(rule.registryPackSlug) : null;
    if (!pack) continue;

    const from = rule.registryVersion ?? 0;
    if (pack.version <= from) continue;

    updates.push({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleSlug: slug,
      packSlug: pack.slug,
      fromVersion: from,
      toVersion: pack.version,
      locallyModified: hashConfig(rule.config ?? {}) !== rule.registryConfigHash,
    });
  }

  return updates;
}

/**
 * Re-resolve a rule against the published version and write it back.
 *
 * The rule's *current* sections are reused as the resolution target — the user
 * chose those libraries at import time and an update isn't the moment to
 * second-guess them. A rule scoped to no section can't be resolved (tag keys
 * are per-section), so it's refused with an explanation rather than silently
 * updated with unresolvable clauses.
 *
 * The same reasoning covers the knobs the import modal offers — pinning,
 * rotation size, limit, min-items. Those are answers about *this* library, so
 * `carryOverUserChoices` keeps them and the update only refreshes the rest.
 */
export async function applyUpdate(
  ruleId: string,
  sectionsByTitle: Map<string, string>,
  lookup: TagLookup,
): Promise<Rule> {
  const rule = getRules().find((r) => r.id === ruleId);
  if (!rule) throw new Error("Rule not found.");
  if (!rule.registryRuleSlug) throw new Error("This rule didn't come from the registry.");

  const { packsBySlug, rulesBySlug } = await getRegistry();
  const published = rulesBySlug.get(rule.registryRuleSlug);
  if (!published) throw new Error("This rule is no longer published in the registry.");

  const pack = rule.registryPackSlug ? packsBySlug.get(rule.registryPackSlug) : null;

  const titles = (rule.config?.sections as string[] | undefined) ?? [];
  const targets: ResolveTarget[] = titles.flatMap((title) => {
    const sectionId = sectionsByTitle.get(title.toLowerCase());
    return sectionId ? [{ sectionId, sectionTitle: title }] : [];
  });
  if (targets.length === 0) {
    throw new Error(
      `"${rule.name}" isn't scoped to a library that exists on this server, so it can't be updated automatically. Edit its libraries and try again.`,
    );
  }

  const { config: republished } = await resolveRuleForImport(published, targets, lookup);
  // An update refreshes what the rule matches; it never revisits the choices
  // the user made when they imported it.
  const config = carryOverUserChoices(rule.config ?? {}, republished);
  updateRule(ruleId, {
    config,
    registryVersion: pack?.version ?? rule.registryVersion,
    registryConfigHash: hashConfig(config),
  });

  return { ...rule, config };
}
