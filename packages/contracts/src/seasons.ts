/**
 * Seasons: the holidays a collection should exist for, and only for.
 *
 * One table for the two things that build seasonal collections — the Season
 * Collections feature and the `seasonal` rule type. They used to disagree:
 * the rule kept its own list, most of whose keyword ids pointed at unrelated
 * keywords ("space", "zombie", "pop star"), and it only produced anything
 * because it also took every film released that month. A December release is
 * not a Christmas film, so the release month is gone and the ids are the ones
 * TMDb actually files those holidays under (checked against
 * themoviedb.org/keyword/<id> when written — `fetchKeyword` in
 * `@tinkerbell/tmdb` re-checks one).
 *
 * The feature stores *overrides* of these presets, keyed by preset key, rather
 * than a copy of the list. A copy would freeze the table at install time: a
 * preset added or corrected in a later release would never reach a server
 * that had already saved its settings once.
 */
import { z } from "zod";
import { isMonthDayWindowActive, monthDaySchema } from "./rule-schedule.ts";

export interface SeasonKeyword {
  id: number;
  name: string;
}

export interface SeasonPreset {
  /** Stable. Stored in config overrides and as the `Season:<key>` label on a row. */
  key: string;
  /** The row's title. Also the bucket label the `seasonal` rule produces, so rules filtering on it keep working. */
  name: string;
  activeFrom: string;
  activeTo: string;
  keywords: SeasonKeyword[];
  /**
   * On unless the admin turns it off. Thanksgiving and Summer are off: one is
   * a US holiday and the other is summer in only one hemisphere, so either
   * appearing unasked on a server elsewhere would look like a bug.
   */
  enabled: boolean;
}

export const SEASON_PRESETS: readonly SeasonPreset[] = [
  {
    key: "christmas",
    name: "Christmas",
    activeFrom: "12-01",
    activeTo: "12-26",
    keywords: [
      { id: 207317, name: "christmas" },
      { id: 260365, name: "christmas eve" },
      { id: 5570, name: "christmas tree" },
      { id: 1991, name: "santa claus" },
      { id: 1441, name: "christmas party" },
    ],
    enabled: true,
  },
  {
    key: "halloween",
    name: "Halloween",
    activeFrom: "10-01",
    activeTo: "10-31",
    keywords: [
      { id: 3335, name: "halloween" },
      { id: 9694, name: "halloween party" },
      { id: 182794, name: "halloween costume" },
      { id: 180193, name: "trick or treating" },
    ],
    enabled: true,
  },
  {
    key: "valentines",
    name: "Valentine's Day",
    activeFrom: "02-01",
    activeTo: "02-14",
    keywords: [
      { id: 160404, name: "valentine's day" },
      { id: 251912, name: "valentine" },
    ],
    enabled: true,
  },
  {
    key: "thanksgiving",
    name: "Thanksgiving",
    activeFrom: "11-01",
    activeTo: "11-30",
    keywords: [
      { id: 4543, name: "thanksgiving" },
      { id: 374738, name: "thanksgiving dinner" },
    ],
    enabled: false,
  },
  {
    key: "new_year",
    name: "New Year's Eve",
    activeFrom: "12-27",
    activeTo: "01-01",
    keywords: [
      { id: 613, name: "new year's eve" },
      { id: 252123, name: "new year" },
      { id: 5632, name: "new year's day" },
    ],
    enabled: true,
  },
  {
    key: "summer",
    name: "Summer",
    activeFrom: "06-21",
    activeTo: "08-31",
    keywords: [
      { id: 13088, name: "summer" },
      { id: 14714, name: "summer vacation" },
      { id: 213450, name: "summer holiday" },
    ],
    enabled: false,
  },
];

export const seasonKeywordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
});

/**
 * A change to a preset. Every field optional: absent means "the preset's",
 * which is what lets a corrected preset reach a server that edited only the
 * window. Unknown keys are kept and ignored, never rejected — a later release
 * that retires a preset must not turn every stored config into an error.
 */
export const seasonOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  activeFrom: monthDaySchema.optional(),
  activeTo: monthDaySchema.optional(),
  keywords: z.array(seasonKeywordSchema).max(30).optional(),
});
export type SeasonOverride = z.infer<typeof seasonOverrideSchema>;

/** `custom-` so a custom key can never collide with a preset added later. */
export const CUSTOM_SEASON_KEY = /^custom-[a-z0-9-]{1,40}$/;

export const customSeasonSchema = z.object({
  key: z.string().regex(CUSTOM_SEASON_KEY, "Custom season keys start with custom-"),
  name: z.string().trim().min(1).max(60),
  activeFrom: monthDaySchema,
  activeTo: monthDaySchema,
  keywords: z.array(seasonKeywordSchema).min(1).max(30),
  enabled: z.boolean().optional(),
});
export type CustomSeason = z.infer<typeof customSeasonSchema>;

export interface ResolvedSeason {
  key: string;
  name: string;
  activeFrom: string;
  activeTo: string;
  keywords: SeasonKeyword[];
  enabled: boolean;
  custom: boolean;
}

export interface SeasonsConfig {
  seasons?: Record<string, SeasonOverride>;
  customSeasons?: CustomSeason[];
}

/** The presets with the admin's overrides laid over them, then the custom seasons, in that order. */
export function resolveSeasons(config: SeasonsConfig): ResolvedSeason[] {
  const overrides = config.seasons ?? {};
  const presets = SEASON_PRESETS.map((preset) => {
    const o = overrides[preset.key] ?? {};
    // A window is one thing: an override carrying only one end keeps the
    // preset's window rather than pairing a stored start with a shipped end.
    const window = o.activeFrom && o.activeTo ? { activeFrom: o.activeFrom, activeTo: o.activeTo } : preset;
    return {
      key: preset.key,
      name: o.name ?? preset.name,
      activeFrom: window.activeFrom,
      activeTo: window.activeTo,
      keywords: o.keywords ?? preset.keywords,
      enabled: o.enabled ?? preset.enabled,
      custom: false,
    };
  });
  const customs = (config.customSeasons ?? []).map((c) => ({
    key: c.key,
    name: c.name,
    activeFrom: c.activeFrom,
    activeTo: c.activeTo,
    keywords: c.keywords,
    enabled: c.enabled ?? true,
    custom: true,
  }));
  return [...presets, ...customs];
}

/** The enabled seasons whose window contains `date`, in `timezone`. */
export function activeSeasons(seasons: ResolvedSeason[], date: Date, timezone?: string): ResolvedSeason[] {
  return seasons.filter((s) => s.enabled && isMonthDayWindowActive(s.activeFrom, s.activeTo, date, timezone));
}

/** Cross-field checks for `configIssues`, in the words the settings page shows. */
export function seasonsConfigIssues(config: SeasonsConfig): string[] {
  const issues: string[] = [];
  for (const [key, o] of Object.entries(config.seasons ?? {})) {
    if ((o.activeFrom == null) !== (o.activeTo == null)) {
      const name = SEASON_PRESETS.find((p) => p.key === key)?.name ?? key;
      issues.push(`${name}: a date window needs both a start and an end`);
    }
  }
  const presetKeys = new Set(SEASON_PRESETS.map((p) => p.key));
  const seen = new Set<string>();
  for (const c of config.customSeasons ?? []) {
    if (presetKeys.has(c.key) || seen.has(c.key)) issues.push(`Two seasons share the key "${c.key}"`);
    seen.add(c.key);
  }
  const resolved = resolveSeasons(config);
  // Names become row titles, and two rows in one library with one title would
  // be indistinguishable on Home.
  const names = new Map<string, number>();
  for (const s of resolved) names.set(s.name.toLowerCase(), (names.get(s.name.toLowerCase()) ?? 0) + 1);
  for (const [name, count] of names) {
    if (count > 1)
      issues.push(`More than one season is called "${resolved.find((s) => s.name.toLowerCase() === name)?.name}"`);
  }
  for (const s of resolved) {
    if (s.enabled && s.keywords.length === 0) issues.push(`${s.name} is on but has no keywords to find titles by`);
  }
  return issues;
}
