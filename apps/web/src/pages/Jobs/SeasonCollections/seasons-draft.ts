/**
 * The Seasons panel's draft, and the config it saves.
 *
 * The panel edits the resolved list — every preset with its overrides, then
 * the custom seasons — because that is what a person reads. What it saves is
 * only the difference from the presets: a field equal to the shipped value is
 * not stored, so a corrected preset reaches a server that once edited the
 * same season's window. Saving an untouched list stores nothing at all.
 */
import {
  resolveSeasons,
  SEASON_PRESETS,
  type CustomSeason,
  type ResolvedSeason,
  type SeasonOverride,
  type SeasonsConfig,
} from "@rube/contracts";

export type SeasonDraft = ResolvedSeason[];

export function draftFromConfig(config: SeasonsConfig): SeasonDraft {
  return resolveSeasons(config);
}

const sameKeywords = (a: ResolvedSeason["keywords"], b: ResolvedSeason["keywords"]) =>
  a.length === b.length && a.every((k, i) => k.id === b[i].id);

/**
 * The config patch for a draft. `null` for a key with nothing to store, which
 * `applyConfigPatch` reads as "remove it" — so resetting the last edited
 * preset clears `seasons` rather than leaving `{}` behind.
 */
export function patchFromDraft(draft: SeasonDraft): {
  seasons: Record<string, SeasonOverride> | null;
  customSeasons: CustomSeason[] | null;
} {
  const seasons: Record<string, SeasonOverride> = {};
  for (const preset of SEASON_PRESETS) {
    const edited = draft.find((s) => s.key === preset.key);
    if (!edited) continue;
    const o: SeasonOverride = {};
    if (edited.enabled !== preset.enabled) o.enabled = edited.enabled;
    if (edited.name.trim() !== preset.name) o.name = edited.name.trim();
    // A window is stored whole or not at all; see `resolveSeasons`.
    if (edited.activeFrom !== preset.activeFrom || edited.activeTo !== preset.activeTo) {
      o.activeFrom = edited.activeFrom;
      o.activeTo = edited.activeTo;
    }
    if (!sameKeywords(edited.keywords, preset.keywords)) o.keywords = edited.keywords;
    if (Object.keys(o).length > 0) seasons[preset.key] = o;
  }
  const customSeasons = draft
    .filter((s) => s.custom)
    .map((s) => ({
      key: s.key,
      name: s.name.trim(),
      activeFrom: s.activeFrom,
      activeTo: s.activeTo,
      keywords: s.keywords,
      ...(s.enabled ? {} : { enabled: false }),
    }));
  return {
    seasons: Object.keys(seasons).length > 0 ? seasons : null,
    customSeasons: customSeasons.length > 0 ? customSeasons : null,
  };
}

/** Has the draft changed from what is stored? Compared as patches, so key order and absent-vs-default don't count. */
export function draftDirty(draft: SeasonDraft, stored: SeasonsConfig): boolean {
  return JSON.stringify(patchFromDraft(draft)) !== JSON.stringify(patchFromDraft(draftFromConfig(stored)));
}

/** A new custom season's key: `custom-` plus its name, made unique. */
export function customKey(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "season";
  let key = `custom-${slug}`;
  for (let n = 2; used.has(key); n++) key = `custom-${slug}-${n}`;
  return key;
}

/** The preset a season resets to, or undefined for a custom one. */
export function presetFor(key: string): ResolvedSeason | undefined {
  const preset = SEASON_PRESETS.find((p) => p.key === key);
  return preset && { ...preset, keywords: [...preset.keywords], custom: false };
}
