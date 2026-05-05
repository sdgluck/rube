export type NavItem = { to: string; label: string; badge?: "streams" };
export type NavSection = { label: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    items: [
      { to: "/stats", label: "Stats", badge: "streams" },
      { to: "/preview", label: "Preview" },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/collections", label: "Collections" },
      { to: "/media", label: "Media" },
      { to: "/overlays", label: "Overlays" },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/rules", label: "Rules" },
      { to: "/jobs", label: "Jobs" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/users", label: "Users" },
      { to: "/events", label: "Events" },
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
