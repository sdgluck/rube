/**
 * The curated packs. Rules are the atomic unit — a pack is a named grouping
 * that references rules by slug, so a rule can appear in more than one pack
 * without being duplicated.
 *
 * `version` is bumped whenever a member rule's config changes. Instances that
 * imported an older version see an update prompt; instances whose copy of the
 * rule has been edited locally are told about the update but never overwritten.
 */
import type { RegistryPackInput } from "@rube/contracts";

export const PACKS: RegistryPackInput[] = [
  {
    slug: "netflix-style",
    title: "Netflix Style",
    tagline: "The rows a streaming service would build for your library.",
    description:
      "Recreates the shape of a commercial streaming home screen: something trending, something new, something " +
      "acclaimed, and a personalized row per user. The closest thing to a one-click 'make my Plex look like " +
      "Netflix' — start here if you're not sure which pack to try.",
    version: 3,
    tags: ["starter", "home screen", "popular"],
    ruleSlugs: ["trending-now", "new-arrivals", "top-rated", "award-winners", "picked-for-you"],
  },
  {
    slug: "cinephiles-shelf",
    title: "Cinephile's Shelf",
    tagline: "Browse by director, country, and era instead of by genre.",
    description:
      "For libraries curated rather than accumulated. Auteur shelves from TMDb crew data, world cinema by country " +
      "of origin, decade sections, and a source-material breakdown for the adaptations.",
    version: 3,
    tags: ["film", "curated"],
    ruleSlugs: ["auteur-directors", "by-country", "by-decade", "top-rated", "based-on", "modern-classics"],
  },
  {
    slug: "family-movie-night",
    title: "Family Movie Night",
    tagline: "Everything safe, sorted, and one tap from the home screen.",
    description:
      "Content-rating shelves so the safe material is obvious, animation studios because that's genuinely how kids " +
      "browse, a runtime cap for the nights that need one, and an AI-curated comfort-watch row.",
    version: 3,
    tags: ["family", "kids"],
    ruleSlugs: ["kid-safe", "animation-studios", "family-genres", "date-night-runtime", "sunday-afternoon"],
  },
  {
    slug: "spooky-season",
    title: "Spooky Season",
    tagline: "October, handled.",
    description:
      "Horror by decade and subgenre, a shelf of horror you own but have never started, and a Halloween shelf " +
      "that puts itself up on 1 October and takes itself down on 1 November. The rest stay until you switch them off.",
    version: 4,
    tags: ["seasonal", "horror"],
    ruleSlugs: ["horror-by-decade", "horror-subgenres", "unwatched-horror", "seasonal-picks", "spooky-ai"],
  },
  {
    slug: "home-theatre-demo",
    title: "Home Theatre Demo",
    tagline: "The shelf you reach for when someone asks to see what the system can do.",
    description:
      "Resolution and source-format collections, plus a high-bitrate 'reference quality' shelf built from a smart " +
      "filter. Tune the bitrate threshold after import — 30 Mbps suits a 4K-heavy library, less so a 1080p one.",
    version: 3,
    tags: ["quality", "4k", "hdr"],
    ruleSlugs: ["resolutions", "video-formats", "reference-quality", "atmos-and-surround"],
  },
  {
    slug: "prestige-tv",
    title: "Prestige TV",
    tagline: "For the TV library that earns its own home screen.",
    description:
      "Network shelves, Rotten Tomatoes acclaim via OMDb, award winners, and a shelf of series nobody has started " +
      "yet. Point this at a TV section — several of its rules are show-only.",
    version: 3,
    tags: ["tv", "prestige"],
    ruleSlugs: ["by-network", "critically-acclaimed-tv", "unstarted-series", "tv-award-winners"],
  },
  {
    slug: "hidden-gems",
    title: "Hidden Gems",
    tagline: "Make the backlog browsable.",
    description:
      "Aimed at large libraries where good material disappears below the fold. Unwatched-and-well-rated, year " +
      "shelves that surface older titles, an affectionate worst-of, and an AI row for combinations you'd never " +
      "think to build.",
    version: 3,
    tags: ["backlog", "discovery"],
    ruleSlugs: ["hidden-gems", "forgotten-years", "lowest-rated", "unexpected-pairings"],
  },
  {
    slug: "request-queue",
    title: "Request Queue",
    tagline: "Close the loop with the people who asked for things.",
    description:
      "Turns Overseerr/Jellyseerr request state into shelves: what's approved, what's landed, what's still waiting. " +
      "Needs Overseerr configured under Settings → Integrations.",
    version: 2,
    tags: ["overseerr", "requests"],
    ruleSlugs: ["seerr-approved", "seerr-available", "seerr-pending", "box-office"],
  },
  {
    slug: "franchise-vault",
    title: "Franchise Vault",
    tagline: "Every saga in one place, and the gaps made obvious.",
    description:
      "Franchise and studio-universe collections from TMDb, plus adaptation and streaming-original shelves. Pairs " +
      "well with the arr action if you want Rube to fill in the films you're missing.",
    version: 3,
    tags: ["franchise", "tmdb"],
    ruleSlugs: ["franchises", "studio-universes", "based-on", "streaming-originals"],
  },
  {
    slug: "around-the-world",
    title: "Around the World",
    tagline: "A library that doesn't default to English.",
    description:
      "Country of origin, audio language, and subtitle availability — the three things that actually determine " +
      "whether a non-English title gets watched — plus an AI shelf that groups by movement rather than by border.",
    version: 3,
    tags: ["world cinema", "languages"],
    ruleSlugs: ["by-country", "by-audio-language", "by-subtitle-language", "international-acclaim"],
  },
];
