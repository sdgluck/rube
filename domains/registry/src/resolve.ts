/**
 * Turns a published rule into one this Plex server can actually run.
 *
 * Three things in a rule are instance-local, and all three are handled here:
 *
 *  1. **Tag values.** Plex stores smart-filter values for tag fields as
 *     numeric keys unique to the server — `genre = "5840"`. Registry packs
 *     publish display names instead, and this module swaps them for local
 *     keys. The walk itself lives in `@rube/contracts`
 *     (`translateSmartFilterTags`), shared with the bundle exporter, which
 *     needs exactly the same traversal in the opposite direction.
 *  2. **Section scope.** Packs never ship `config.sections`; the importing
 *     user picks target libraries and they're written in here.
 *  3. **arr settings.** Packs never ship `config.arr` (quality-profile ids
 *     and root folder paths are per-host), and nothing here invents one.
 *
 * Deliberately free of DB and Plex-client imports — the tag lookup arrives as
 * a callback, so this is testable without either.
 */
import { translateSmartFilterTags, type RegistryRule, type ResolutionWarning } from "@rube/contracts";

export type { TagLookup } from "@rube/contracts";
import type { TagLookup } from "@rube/contracts";

export interface ResolveTarget {
  sectionId: string;
  sectionTitle: string;
}

export interface ResolvedRule {
  config: Record<string, unknown>;
  warnings: ResolutionWarning[];
}

/**
 * Resolve one published rule against the chosen libraries.
 *
 * Tag keys are per-section, so a filter can only be resolved against one
 * section at a time. When several are selected we resolve against the first
 * — the same compromise the rule itself makes, since one `smartFilter` runs
 * verbatim across every section it's scoped to. Any clause that fails to
 * resolve in *any* selected section is reported, so the user sees the whole
 * picture rather than just the first library's.
 */
export async function resolveRuleForImport(
  rule: RegistryRule,
  targets: ResolveTarget[],
  lookup: TagLookup,
): Promise<ResolvedRule> {
  const config: Record<string, unknown> = { ...rule.config };
  const warnings: ResolutionWarning[] = [];

  // Sections are matched by title at run time (`filterSections`), so titles
  // are what we write — not the numeric keys used for the tag lookup.
  config.sections = targets.map((t) => t.sectionTitle);

  // Never inherited from a pack, but belt and braces: an arr block that
  // slipped through would point at a quality profile that doesn't exist here.
  delete config.arr;

  if (rule.type === "smart_filter" && config.smartFilter) {
    const primary = targets[0];
    if (primary) {
      let translated;
      try {
        translated = await translateSmartFilterTags(config.smartFilter, {
          target: primary,
          alsoWarnAgainst: targets.slice(1),
          direction: "toKeys",
          lookup,
        });
      } catch (err) {
        throw new Error(
          `Registry rule "${rule.slug}" has an invalid smart filter: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      config.smartFilter = translated.smartFilter;
      warnings.push(...translated.warnings.map((w) => ({ ruleSlug: rule.slug, ...w })));
    }
  }

  return { config, warnings };
}
