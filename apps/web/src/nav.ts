import { SETTINGS_LINKS } from "#pages/Settings/sections";

export type NavMetric =
  | {
      kind: "count";
      key: "collections" | "media" | "rules" | "users" | "eventsErrors24h" | "prerolls" | "cleanupDueSoon" | "arrQueue";
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
export type NavSection = { label: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    items: [
      { to: "/stats", label: "Stats", metric: { kind: "streams" } },
      { to: "/preview", label: "Preview" },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/collections", label: "Collections", metric: { kind: "count", key: "collections" } },
      { to: "/media", label: "Media", metric: { kind: "count", key: "media" } },
      { to: "/duplicates", label: "Duplicates" },
      { to: "/overlays", label: "Overlays", metric: { kind: "status", key: "overlaysStatus" } },
      { to: "/prerolls", label: "Prerolls", metric: { kind: "count", key: "prerolls" } },
    ],
  },
  // Between Library (what Plex holds) and Automation (what Tinkerbell does
  // about it), because that is where acquiring things belongs: after you know
  // what you have, before you decide what to do with it.
  {
    label: "Managers",
    items: [
      { to: "/movies", label: "Movies" },
      { to: "/tv", label: "TV" },
      { to: "/downloads", label: "Downloads", metric: { kind: "count", key: "arrQueue" } },
      { to: "/arrs", label: "Instances", metric: { kind: "status", key: "arrsStatus" } },
    ],
  },
  {
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
 * The menu as it should render for this install.
 *
 * Takes the flag rather than reading it, so the same filter serves the sidebar
 * and the mobile More page from one query. `setupComplete` is undefined while
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

export type Crumb = { label: string; to: string };

/**
 * The route's place in the nav, as a breadcrumb trail — the app bar's answer
 * to "where am I" now that pages don't render a title of their own.
 *
 * Drill-in routes (/jobs/:id, /media/:key) stop at their section, because the
 * record's name isn't in the URL — the page appends it with <PageCrumbs>, which
 * is also what turns the section above it back into a link. Settings is the
 * exception that can be resolved from the path alone.
 */
export function routeTrail(pathname: string): Crumb[] {
  // Rail links that leave /settings (Setup) belong to whatever section they
  // actually live in, not under a Settings crumb.
  const settings = SETTINGS_LINKS.find(
    (l) => l.to.startsWith("/settings/") && (pathname === l.to || pathname.startsWith(`${l.to}/`)),
  );
  if (settings)
    return [
      { label: "Settings", to: "/settings" },
      { label: settings.label, to: settings.to },
    ];

  const extras: Crumb[] = [
    { label: "Changelog", to: "/settings/changelog" },
    { label: "More", to: "/more" },
    { label: "Registry", to: "/registry" },
  ];
  const items: Crumb[] = [
    ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ label: i.label, to: i.to }))),
    ...extras,
  ];

  let best: Crumb | null = null;
  for (const item of items) {
    if ((pathname === item.to || pathname.startsWith(`${item.to}/`)) && item.to.length > (best?.to.length ?? 0)) {
      best = item;
    }
  }
  return best ? [best] : [];
}

const BOTTOM_TAB_ROUTES = new Set(["/stats", "/collections", "/jobs"]);

export const MORE_SECTIONS: NavSection[] = NAV_SECTIONS.map((s) => ({
  label: s.label,
  items: s.items.filter((i) => !BOTTOM_TAB_ROUTES.has(i.to)),
})).filter((s) => s.items.length > 0);
