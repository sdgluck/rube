export type NavMetric =
  | {
      kind: "count";
      key:
        | "collections"
        | "media"
        | "rules"
        | "users"
        | "eventsErrors24h"
        | "prerolls"
        | "cleanupDueSoon"
        | "arrQueue"
        | "problems";
    }
  | { kind: "status"; key: "overlaysStatus" | "jobsStatus" | "arrsStatus" }
  | { kind: "streams" };

export type NavItem = {
  to: string;
  label: string;
  metric?: NavMetric;
  /**
   * Drop this item from the menus once setup is finished.
   *
   * For pages that are scaffolding rather than furniture: worth a permanent
   * slot while they still have something to say, clutter afterwards. The page
   * stays routed and stays listed under Settings — hiding the shortcut is not
   * the same as taking the page away.
   */
  hideWhenSetupComplete?: boolean;
};
/**
 * `id` is what the saved section order is stored against, and it is not the
 * label: a label is a display string, and renaming one would otherwise reset
 * every install's order without anybody touching it.
 */
export type NavSection = { id: string; label: string; items: NavItem[] };

/**
 * Every page the app has a menu entry for — the *catalogue*, not the menu.
 *
 * Four things read this list unfiltered on purpose: `routeTrail` (the app bar's
 * breadcrumb), `useDocumentTitle`, `RouteAnnouncer` and the command palette. The
 * admin's own menu layout — order and hidden items — is applied by
 * `resolveNav` and lives only in the thing that renders a menu (`Sidebar`,
 * which is also the drawer below --bp-md). Hiding a page from the menu must never make
 * it unreachable, untitled or unbreadcrumbed, which is exactly what would
 * happen if the filter moved into this constant.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      { to: "/stats", label: "Stats", metric: { kind: "streams" } },
      { to: "/preview", label: "Preview" },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { to: "/collections", label: "Collections", metric: { kind: "count", key: "collections" } },
      { to: "/media", label: "Media", metric: { kind: "count", key: "media" } },
      // First in Library: it is the page that says what needs doing about
      // everything else in this section.
      { to: "/problems", label: "Problems", metric: { kind: "count", key: "problems" } },
      { to: "/duplicates", label: "Duplicates" },
      { to: "/overlays", label: "Overlays", metric: { kind: "status", key: "overlaysStatus" } },
      { to: "/prerolls", label: "Prerolls", metric: { kind: "count", key: "prerolls" } },
    ],
  },
  // Between Library (what Plex holds) and Automation (what Rube does
  // about it), because that is where acquiring things belongs: after you know
  // what you have, before you decide what to do with it.
  {
    id: "managers",
    label: "Managers",
    items: [
      { to: "/discover", label: "Discover" },
      { to: "/movies", label: "Movies" },
      { to: "/movies/unused-4k", label: "Unused 4K" },
      { to: "/tv", label: "TV" },
      { to: "/downloads", label: "Downloads", metric: { kind: "count", key: "arrQueue" } },
      { to: "/arrs", label: "Instances", metric: { kind: "status", key: "arrsStatus" } },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    items: [
      { to: "/rules", label: "Rules", metric: { kind: "count", key: "rules" } },
      { to: "/cleanup", label: "Cleanup", metric: { kind: "count", key: "cleanupDueSoon" } },
      { to: "/metadata", label: "Metadata" },
      { to: "/registry", label: "Registry" },
      { to: "/jobs", label: "Jobs", metric: { kind: "status", key: "jobsStatus" } },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { to: "/users", label: "Users", metric: { kind: "count", key: "users" } },
      { to: "/events", label: "Events", metric: { kind: "count", key: "eventsErrors24h" } },
      // Beside Events on purpose: Events is what the app said, Changes is what
      // the app did. The two are read together after a bad night.
      { to: "/changes", label: "Changes" },
      { to: "/settings", label: "Settings" },
      // Here only while there is still setup to do — that is when a sidebar
      // slot earns its place, including for someone who dismissed the banner
      // and needs a way back to an unfinished step. Once every step is done it
      // moves to Settings › Setup, which is where you would look for it on the
      // day you want to re-read what is connected.
      { to: "/onboarding", label: "Setup", hideWhenSetupComplete: true },
    ],
  },
];

/**
 * The one item the menu editor may not switch off.
 *
 * Enforced when the menu is resolved rather than in the editor, because the
 * editor is not the only way a bad value arrives: a restored export, a
 * hand-edited row or a future bug could all produce a menu whose only route to
 * the settings that would fix it is a keyboard chord the user may not know
 * about. With Settings pinned, "at least one visible item" holds transitively
 * and needs no rule of its own.
 */
export const UNHIDEABLE = "/settings";

/**
 * The `nav_*` config keys the menu reads, as the resolvers below want them.
 */
export type NavPrefs = {
  hidden?: string[];
  itemOrder?: string[];
  sectionOrder?: string[];
};

/**
 * A saved order, reconciled with the ids that actually exist.
 *
 * Deliberately not `usePanelOrder`'s reconciliation, which appends ids the user
 * has never seen to the *end* of the list. That is right for a dashboard, where
 * a new panel at the bottom is a new panel at the bottom, and wrong for a menu:
 * a page added to Library in a later release has to land in Library, not
 * underneath Settings. So an unplaced id goes back beside the neighbour it
 * shipped next to — immediately after the nearest earlier default already
 * placed, or at the front if it has none.
 *
 * Unknown and duplicate saved ids are dropped, so the result is always a
 * permutation of `defaults` however stale or hand-mangled the saved value is.
 */
export function mergeOrder(defaults: readonly string[], saved: readonly string[] | undefined): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  const placed = new Set<string>();
  for (const id of saved ?? []) {
    if (known.has(id) && !placed.has(id)) {
      out.push(id);
      placed.add(id);
    }
  }
  for (let i = 0; i < defaults.length; i++) {
    const id = defaults[i];
    if (placed.has(id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = defaults[j];
      if (placed.has(prev)) {
        at = out.indexOf(prev) + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    placed.add(id);
  }
  return out;
}

export function defaultSectionOrder(sections: readonly NavSection[]): string[] {
  return sections.map((s) => s.id);
}

export function defaultItemOrder(sections: readonly NavSection[]): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.to));
}

/**
 * The catalogue, rearranged the way this install asked for.
 *
 * Items are sorted by their position in one flat order but only *within* their
 * own section, which is what makes "an item cannot move between sections" a
 * property of the data rather than a rule the editor has to enforce: a saved
 * position that would carry an item across a boundary is simply inert.
 */
export function applyNavPrefs(sections: NavSection[], prefs: NavPrefs): NavSection[] {
  const sectionRank = new Map(mergeOrder(defaultSectionOrder(sections), prefs.sectionOrder).map((id, i) => [id, i]));
  const itemRank = new Map(mergeOrder(defaultItemOrder(sections), prefs.itemOrder).map((to, i) => [to, i]));
  const hidden = new Set((prefs.hidden ?? []).filter((to) => to !== UNHIDEABLE));

  return [...sections]
    .sort((a, b) => (sectionRank.get(a.id) ?? 0) - (sectionRank.get(b.id) ?? 0))
    .map((section) => ({
      ...section,
      items: section.items
        .filter((i) => !hidden.has(i.to))
        .sort((a, b) => (itemRank.get(a.to) ?? 0) - (itemRank.get(b.to) ?? 0)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * The menu as it should render for this install.
 *
 * Takes the flag rather than reading it, so the filter stays a pure function
 * of its inputs and the sidebar and the editor share one query. `setupComplete` is undefined while
 * that query is in flight, and an item stays put until we know otherwise —
 * hiding it first and putting it back a moment later would be a menu that
 * flickers on every page load.
 */
export function visibleSections(sections: NavSection[], setupComplete: boolean | undefined): NavSection[] {
  if (!setupComplete) return sections;
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hideWhenSetupComplete) }))
    .filter((s) => s.items.length > 0);
}

/**
 * What the menu actually renders: the admin's layout, then the setup filter.
 *
 * That order matters — a section emptied by the two together still collapses,
 * and `visibleSections` keeps its "undefined means leave it alone" contract
 * rather than having to learn about prefs.
 */
export function resolveNav(sections: NavSection[], prefs: NavPrefs, setupComplete: boolean | undefined): NavSection[] {
  return visibleSections(applyNavPrefs(sections, prefs), setupComplete);
}
