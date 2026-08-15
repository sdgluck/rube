/**
 * Smart-filter rules — the only rules in the registry that carry Plex filter
 * clauses directly.
 *
 * Tag values here are written as **display names** (`genre = "Horror"`),
 * never as the numeric Plex tag keys the admin UI stores. Tag keys are
 * per-server, so a published `genre = "5840"` would silently match nothing
 * on anyone else's library. `domains/registry`'s resolver translates these
 * names to local keys at import time, and `registry.test.ts` fails the build
 * if a numeric value ever sneaks in.
 *
 * Avoided deliberately: `show.`-prefixed advanced fields. Plex only honours
 * them with `includeAdvanced=1`, which the smart-filter handler doesn't emit,
 * so such a rule would return nothing with no error to explain why.
 */
import type { RegistryRuleInput } from "@tinkerbell/contracts";

export const SMART_RULES: RegistryRuleInput[] = [
  {
    slug: "new-arrivals",
    name: "New Arrivals",
    description: "Everything added in the last 30 days, in one shelf. Uses Plex's relative-date syntax.",
    type: "smart_filter",
    config: {
      collectionName: "New Arrivals",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [{ kind: "leaf", field: "addedAt", op: ">=", value: "-30d" }],
      },
      presentation: { poster: "mosaic" },
    },
  },
  {
    slug: "unwatched-horror",
    name: "Unwatched Horror",
    description: "Horror you own and have never started. The single most useful shelf in October.",
    type: "smart_filter",
    config: {
      collectionName: "Unwatched Horror",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [
          { kind: "leaf", field: "genre", op: "=", value: "Horror" },
          { kind: "leaf", field: "unwatched", op: "=", value: "1" },
        ],
      },
      presentation: { poster: "mosaic", accentColor: "#B3261E" },
    },
  },
  {
    slug: "hidden-gems",
    name: "Unwatched & Great",
    description: "Rated 7.5 or better and still unplayed — the backlog worth clearing first.",
    type: "smart_filter",
    config: {
      collectionName: "Hidden Gems",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [
          { kind: "leaf", field: "unwatched", op: "=", value: "1" },
          { kind: "leaf", field: "rating", op: ">=", value: "7.5" },
        ],
      },
      presentation: { poster: "mosaic" },
    },
  },
  {
    slug: "reference-quality",
    name: "Reference Quality",
    description: "High-bitrate files worth showing the system off with. Tune the threshold to your library.",
    type: "smart_filter",
    config: {
      collectionName: "Reference Quality",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [{ kind: "leaf", field: "mediaBitrate", op: ">=", value: "30000" }],
      },
      presentation: { poster: "mosaic" },
    },
  },
  {
    slug: "unstarted-series",
    name: "Unstarted Series",
    description: "Shows sitting in the library that nobody has begun. Works on any TV section.",
    type: "smart_filter",
    config: {
      collectionName: "Unstarted Series",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [{ kind: "leaf", field: "unwatched", op: "=", value: "1" }],
      },
      presentation: { poster: "mosaic" },
    },
    mediaTypes: ["show"],
  },
  {
    slug: "modern-classics",
    name: "Modern Classics",
    description: "Released in the last twenty years and rated 8 or above. A short, high-confidence shelf.",
    type: "smart_filter",
    config: {
      collectionName: "Modern Classics",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [
          { kind: "leaf", field: "originallyAvailableAt", op: ">=", value: "-20y" },
          { kind: "leaf", field: "rating", op: ">=", value: "8" },
        ],
      },
      presentation: { poster: "mosaic" },
    },
  },
  {
    slug: "date-night-runtime",
    name: "Under Two Hours",
    description: "Nothing over 120 minutes — for the nights where that is the deciding factor.",
    type: "smart_filter",
    config: {
      collectionName: "Under Two Hours",
      pinToHomepage: false,
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [{ kind: "leaf", field: "duration", op: "<=", value: "7200000" }],
      },
      presentation: { poster: "mosaic" },
    },
    mediaTypes: ["movie"],
  },
];
