import { SETTINGS_LINKS } from "#pages/Settings/sections";

export type NavMetric =
  | {
      kind: "count";
      key: "collections" | "media" | "rules" | "users" | "eventsErrors24h" | "prerolls" | "cleanupDueSoon";
    }
  | { kind: "status"; key: "overlaysStatus" | "jobsStatus" }
  | { kind: "streams" };

export type NavItem = { to: string; label: string; metric?: NavMetric };
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
      { to: "/overlays", label: "Overlays", metric: { kind: "status", key: "overlaysStatus" } },
      { to: "/prerolls", label: "Prerolls", metric: { kind: "count", key: "prerolls" } },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/rules", label: "Rules", metric: { kind: "count", key: "rules" } },
      { to: "/cleanup", label: "Cleanup", metric: { kind: "count", key: "cleanupDueSoon" } },
      { to: "/registry", label: "Registry" },
      { to: "/jobs", label: "Jobs", metric: { kind: "status", key: "jobsStatus" } },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/users", label: "Users", metric: { kind: "count", key: "users" } },
      { to: "/events", label: "Events", metric: { kind: "count", key: "eventsErrors24h" } },
      { to: "/settings", label: "Settings" },
    ],
  },
];

export type Crumb = { label: string; to: string };

/**
 * The route's place in the nav, as a breadcrumb trail — the app bar's answer
 * to "where am I" now that pages don't render a title of their own.
 *
 * Drill-in routes (/jobs/:id, /media/:key) stop at their section: the record's
 * own name is the page's business, and it shows it in its back link.
 */
export function routeTrail(pathname: string): Crumb[] {
  const settings = SETTINGS_LINKS.find((l) => pathname === l.to || pathname.startsWith(`${l.to}/`));
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
