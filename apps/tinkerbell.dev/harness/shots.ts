/**
 * Declarative list of screenshots to capture. `name` matches the slug used by
 * the site (src/data/content.ts → /screenshots/<name>.png). Routes are admin-UI
 * paths served by apps/web.
 */

export interface Shot {
  name: string;
  path: string;
  /** Optional selector to wait for before shooting (beyond network idle). */
  waitFor?: string;
  /** Click a button/link with this accessible name before shooting. */
  clickText?: string;
  /** Extra settle time in ms after load (animations, poster fetches). */
  settleMs?: number;
  /** Capture the full scrollable page instead of just the viewport. */
  fullPage?: boolean;
}

export const SHOTS: Shot[] = [
  { name: "overlays", path: "/overlays", settleMs: 1500 },
  { name: "collections", path: "/collections", clickText: "Grid", settleMs: 1500 },
  { name: "rules", path: "/rules", settleMs: 800 },
  { name: "stats", path: "/stats", settleMs: 1000 },
  { name: "preview", path: "/preview", settleMs: 1500 },
  { name: "jobs", path: "/jobs", settleMs: 800 },
  { name: "media", path: "/media", settleMs: 800 },
  { name: "events", path: "/events", settleMs: 600 },
];
