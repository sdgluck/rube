export type NavMetric =
  | { kind: "count"; key: "collections" | "media" | "rules" | "users" | "eventsErrors24h" }
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
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/rules", label: "Rules", metric: { kind: "count", key: "rules" } },
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

const BOTTOM_TAB_ROUTES = new Set(["/stats", "/collections", "/jobs"]);

export const MORE_SECTIONS: NavSection[] = NAV_SECTIONS.map((s) => ({
  label: s.label,
  items: s.items.filter((i) => !BOTTOM_TAB_ROUTES.has(i.to)),
})).filter((s) => s.items.length > 0);

export const MORE_PAGES = MORE_SECTIONS.flatMap((s) => s.items);
