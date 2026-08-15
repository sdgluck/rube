/**
 * Rules backed by something outside Plex — IMDb charts, Rotten Tomatoes via
 * OMDb, and Overseerr/Jellyseerr request queues.
 *
 * Each one declares what it needs in `requires`, so the import preview can
 * warn before the rule is created rather than after it silently no-ops.
 */
import type { RegistryRuleInput } from "@tinkerbell/contracts";

export const EXTERNAL_RULES: RegistryRuleInput[] = [
  {
    slug: "trending-now",
    name: "Trending Now",
    description: "IMDb's Most Popular Movies chart, matched against titles you already have.",
    type: "imdb_chart",
    config: { chart: "popular_movies", pinToHomepage: false, presentation: { poster: "mosaic" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "box-office",
    name: "In Cinemas Now",
    description: "The IMDb box-office chart — a decent proxy for 'what people are talking about this week'.",
    type: "imdb_chart",
    config: { chart: "box_office", pinToHomepage: false, presentation: { poster: "mosaic" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "critically-acclaimed-tv",
    name: "Critically Acclaimed",
    description: "Rotten Tomatoes top-rated titles via OMDb. Needs an OMDb API key.",
    type: "rt_top_rated",
    config: { limit: 100, pinToHomepage: false, presentation: { poster: "mosaic" } },
    mediaTypes: ["show"],
  },
  {
    slug: "seerr-approved",
    name: "Just Approved",
    description: "Requests that have been approved but may not have landed yet.",
    type: "seerr_requests",
    config: { filter: "approved", limit: 50, pinToHomepage: false, presentation: { poster: "gradient" } },
  },
  {
    slug: "seerr-available",
    name: "Now Available",
    description: "Requests that are downloaded and ready — the 'you asked, it's here' shelf.",
    type: "seerr_requests",
    config: { filter: "available", limit: 50, pinToHomepage: false, presentation: { poster: "gradient" } },
  },
  {
    slug: "seerr-pending",
    name: "Awaiting Approval",
    description: "Everything still sitting in the request queue. Handy as an admin-facing shelf.",
    type: "seerr_requests",
    config: { filter: "pending", limit: 50, pinToHomepage: false, presentation: { poster: "gradient" } },
  },
];
