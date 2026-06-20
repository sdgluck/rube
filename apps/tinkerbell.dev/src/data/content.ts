/**
 * Single source of truth for marketing copy. Feature entries reference a
 * screenshot by `shot`, whose filename lives under /public/screenshots and is
 * produced by the capture harness (harness/shots.ts uses the same slugs).
 */

import { Wand2, Images, Layers, Sparkles, ListChecks, Activity, type LucideIcon } from "lucide-react";

export interface Shot {
  /** Slug — matches the harness shot name and the /screenshots/<slug>.png file. */
  slug: string;
  /** Human title shown under the figure. */
  title: string;
  /** One-line caption. */
  caption: string;
}

export interface Feature {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  body: string;
  /** Slug of the screenshot that illustrates this feature (optional). */
  shot?: string;
}

export const GITHUB_URL = "https://github.com/sdgluck/tinkerbell";

export const SHOTS: Shot[] = [
  {
    slug: "overlays",
    title: "Overlay editor",
    caption: "Stamp ratings, badges, and labels onto poster art with a live canvas.",
  },
  {
    slug: "collections",
    title: "Collections",
    caption: "Auto-managed Plex collections with posters, smart flags, and labels.",
  },
  {
    slug: "rules",
    title: "Rules engine",
    caption: "Rules that produce collections from your library, on a schedule.",
  },
  {
    slug: "stats",
    title: "Stats dashboard",
    caption: "Live streams, system health, and library breakdowns at a glance.",
  },
  {
    slug: "preview",
    title: "Home-screen preview",
    caption: "See the Plex home each user gets — hubs, shuffles, and recommendations.",
  },
  {
    slug: "jobs",
    title: "Job runner",
    caption: "Background jobs with schedules, run history, and live logs.",
  },
  {
    slug: "media",
    title: "Media library",
    caption: "Inspect resolution, codecs, and audio across your whole library.",
  },
  {
    slug: "events",
    title: "Activity feed",
    caption: "A timeline of everything Tinkerbell does on your server.",
  },
];

export const SHOTS_BY_SLUG: Record<string, Shot> = Object.fromEntries(SHOTS.map((s) => [s.slug, s]));

export const FEATURES: Feature[] = [
  {
    id: "rules",
    icon: ListChecks,
    title: "Rules engine",
    tagline: "Describe what you want; Tinkerbell keeps it true.",
    body: "Define rules over your Plex metadata, IMDb/OMDb ratings, and Overseerr requests. Each rule produces collections that refresh on a schedule, with full run history so you can see exactly what changed and when.",
    shot: "rules",
  },
  {
    id: "smart-filters",
    icon: Wand2,
    title: "AI smart filters",
    tagline: "Compose criteria — or let Claude draft them.",
    body: 'Build smart filters from Plex metadata, ratings, and request data. AI-assisted generation turns a plain-English idea like "gritty 90s neo-noir" into a concrete, editable filter you can preview before it ever touches your library.',
    shot: "collections",
  },
  {
    id: "overlays",
    icon: Layers,
    title: "Poster overlays",
    tagline: "Ratings and badges, baked into the artwork.",
    body: "A live editor composes overlays onto poster art with sharp — drag badges, stamp ratings and labels, save presets, and bulk-preview the result before applying it across a section.",
    shot: "overlays",
  },
  {
    id: "personalized",
    icon: Sparkles,
    title: "Personalized home screens",
    tagline: "Every user gets a home screen tuned to them.",
    body: "An opt-in, server-wide mode gives each Plex user their own recommendations — Because You Watched rows and per-user collections — with the sharing isolation handled for you, reversibly.",
    shot: "preview",
  },
  {
    id: "jobs",
    icon: Activity,
    title: "Job runner & logs",
    tagline: "Automation you can actually watch.",
    body: "A Sidequest-backed runner executes syncs, generators, and rules on cron schedules. Every run has a detail view with streaming logs, progress, and an ETA — no guessing whether it worked.",
    shot: "jobs",
  },
  {
    id: "stats",
    icon: Images,
    title: "Stats & activity",
    tagline: "Know your server at a glance.",
    body: "A customizable dashboard surfaces active streams, bandwidth, recently added, most watched, and a library breakdown — alongside an activity feed and changelog so nothing happens silently.",
    shot: "stats",
  },
];

export const STACK_BULLETS = [
  "Self-hosted — your data never leaves your server",
  "Loopback-bound by default; portal exposed separately",
  "Discord, Slack, Telegram, Gotify, Pushover & webhooks",
  "Docker image and pnpm monorepo, SQLite-backed",
];
