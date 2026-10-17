import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Circle,
  ClipboardList,
  Clapperboard,
  Copy,
  Download,
  Eye,
  Film,
  LayoutGrid,
  Library,
  Minimize2,
  Compass,
  Layers,
  MoreHorizontal,
  Rocket,
  Server,
  Settings as SettingsIcon,
  Sparkles,
  Tags,
  Trash2,
  Tv,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";

/**
 * An icon for every route the tab bar can be pointed at.
 *
 * The bar used to carry three hand-drawn SVG paths inline because it had three
 * fixed tabs. Now that the admin picks which routes go there, every nav route
 * needs one — and a `Record` of lucide components is the cheapest way to say
 * that, since `lucide-react` is already a dependency and tree-shakes per icon.
 *
 * This file is `.ts` rather than `.tsx` on purpose: the icons are referenced as
 * identifiers, so no JSX is needed, and that keeps it importable from a
 * `*.test.ts` — which is what asserts the map still covers `NAV_SECTIONS` after
 * somebody adds a page.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  // Dashboard
  "/stats": BarChart3,
  "/preview": Eye,
  // Library
  "/collections": LayoutGrid,
  "/media": Library,
  "/problems": AlertTriangle,
  "/duplicates": Copy,
  "/overlays": Layers,
  "/prerolls": Film,
  // Managers
  "/discover": Compass,
  "/movies": Clapperboard,
  "/movies/unused-4k": Minimize2,
  "/tv": Tv,
  "/downloads": Download,
  "/arrs": Server,
  // Automation
  "/rules": Wand2,
  "/cleanup": Trash2,
  "/metadata": Tags,
  "/registry": Sparkles,
  "/jobs": CalendarClock,
  // Admin
  "/users": Users,
  "/events": Activity,
  "/changes": ClipboardList,
  "/settings": SettingsIcon,
  "/onboarding": Rocket,
  // Not a nav item: the bar's own last slot.
  "/more": MoreHorizontal,
};

/**
 * What a route with no icon of its own draws.
 *
 * A page added without a line in the map degrades to a dot, which reads as a
 * plain tab — the alternative is a hole where the icon should be, and the label
 * underneath it already says what the tab is.
 */
export const NAV_ICON_FALLBACK: LucideIcon = Circle;

export function navIcon(to: string): LucideIcon {
  return NAV_ICONS[to] ?? NAV_ICON_FALLBACK;
}
