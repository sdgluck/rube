/**
 * Turning a Media view into a smart-filter rule.
 *
 * Browsing and authoring were two separate acts: you found the set you wanted
 * on Media, then rebuilt it clause by clause in the rule wizard from memory.
 * This carries the filters across.
 *
 * It is deliberately honest about what it can't carry. Plex smart filters have
 * no notion of audio codec, channel count or container, so those filters have
 * no clause to become — and silently dropping them would hand back a rule that
 * matches far more than the list the user was looking at. They come back as
 * `dropped`, and the UI says so before anything is saved.
 */

export interface MediaViewFilters {
  /** Section *keys*, as the Media page stores them. */
  sections: string[];
  types: string[];
  search: string;
  resolutions: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  audioChannels: string[];
  containers: string[];
}

export interface SmartFilterRuleSeed {
  kind: "smart_filter";
  /** Section *titles*, which is what a rule config stores. */
  sections: string[];
  smartFilter: { kind: "group"; combinator: "all"; children: unknown[] };
  /** Filters that have no smart-filter equivalent, in words. */
  dropped: string[];
}

/** Human names for the filters that can't cross over, for the warning. */
const DROPPED_LABELS: Record<string, string> = {
  videoCodecs: "video codec",
  audioCodecs: "audio codec",
  audioChannels: "audio channels",
  containers: "container",
};

/**
 * Build the rule config a view implies.
 *
 * Several values of one filter become an OR group, because ticking three
 * resolutions on the list means "any of these" — turning them into three ANDed
 * clauses would produce a rule that matches nothing at all, which is the
 * failure mode most likely to go unnoticed.
 */
export function ruleSeedFromView(
  filters: MediaViewFilters,
  sectionTitleFor: (key: string) => string | null,
): SmartFilterRuleSeed {
  const children: unknown[] = [];

  if (filters.search.trim()) {
    children.push({ kind: "leaf", field: "title", op: "=", value: filters.search.trim() });
  }

  if (filters.resolutions.length === 1) {
    children.push({ kind: "leaf", field: "resolution", op: "=", value: filters.resolutions[0]! });
  } else if (filters.resolutions.length > 1) {
    children.push({
      kind: "group",
      combinator: "any",
      children: filters.resolutions.map((value) => ({ kind: "leaf", field: "resolution", op: "=", value })),
    });
  }

  const dropped: string[] = [];
  for (const [key, label] of Object.entries(DROPPED_LABELS)) {
    if ((filters[key as keyof MediaViewFilters] as string[]).length > 0) dropped.push(label);
  }

  // Type is not a clause either: a rule's section choice already decides
  // whether it looks at movies or shows, so carrying it as a filter would be
  // saying the same thing twice and getting it wrong on a mixed selection.
  const sections = filters.sections.map(sectionTitleFor).filter((title): title is string => !!title);

  return { kind: "smart_filter", sections, smartFilter: { kind: "group", combinator: "all", children }, dropped };
}

/** The sentence shown before the wizard opens, or null when nothing was lost. */
export function describeDropped(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  const list =
    dropped.length === 1 ? dropped[0] : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
  return (
    `Plex smart filters can't express ${list}, so ${dropped.length === 1 ? "that filter was" : "those filters were"} ` +
    `left out — the rule will match more than this list does.`
  );
}
