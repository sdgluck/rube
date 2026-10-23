/**
 * Rules that group an existing library by a dimension Rube already
 * understands — genre, decade, studio, resolution, and friends.
 *
 * These are the most portable rules in the registry: the grouping is done
 * server-side from TMDb or Plex media info, so there is no per-server tag
 * key to translate and nothing to go stale.
 *
 * They ship uncapped — a collection per director, per decade, per network —
 * because the author can't know how big the target library is, and a cap
 * would silently drop the long tail. What they do bound is the homepage:
 * ten collections at a time, rotated each run, so a rule that builds four
 * hundred shelves still leaves room for everything else — and only shelves
 * with at least three items, since a "Wes Anderson" row holding one film
 * reads as a broken home screen rather than a small one. The collection is
 * still built either way; it just waits in the library until it fills out.
 * The import modal offers all of this (including turning pinning off)
 * before anything is written.
 */
import type { RegistryRuleInput } from "@rube/contracts";

export const LIBRARY_RULES: RegistryRuleInput[] = [
  {
    slug: "top-rated",
    name: "Top Rated",
    description: "Your highest-rated titles, newest ratings first. The dependable 'what's good here?' shelf.",
    type: "top_rated",
    config: { limit: 50, pinToHomepage: false, presentation: { poster: "spotlight" } },
  },
  {
    slug: "lowest-rated",
    name: "So Bad It's Good",
    description: "The bottom of the barrel, collected with affection. Surprisingly popular on movie nights.",
    type: "lowest_rated",
    config: { limit: 30, pinToHomepage: false, presentation: { poster: "spotlight" } },
  },
  {
    slug: "by-decade",
    name: "By Decade",
    description: "A collection per decade, from each title's release year. No integrations needed.",
    type: "decades",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "horror-by-decade",
    name: "Horror Through the Decades",
    description: "Decade collections for a horror library — 70s grit, 80s practical effects, 2010s elevated dread.",
    type: "decades",
    config: {
      pinToHomepage: true,
      pinRotationCount: 10,
      pinMinItems: 3,
      presentation: { poster: "gradient", accentColor: "#B3261E" },
    },
  },
  {
    slug: "forgotten-years",
    name: "Forgotten Years",
    description: "Year-by-year shelves that surface the titles a 'recently added' row will never show you.",
    type: "years",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "horror-subgenres",
    name: "Horror Subgenres",
    description: "Slasher, supernatural, folk horror, body horror — genre shelves for a spooky library.",
    type: "genres",
    config: {
      pinToHomepage: true,
      pinRotationCount: 10,
      pinMinItems: 3,
      presentation: { poster: "gradient", accentColor: "#B3261E" },
    },
  },
  {
    slug: "family-genres",
    name: "Family & Animation",
    description: "Genre collections weighted to what actually gets watched with kids in the room.",
    type: "genres",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "animation-studios",
    name: "Animation Studios",
    description: "Pixar, Ghibli, Aardman, DreamWorks — studio shelves families actually browse by.",
    type: "studios",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
  },
  {
    slug: "studio-universes",
    name: "Studio Universes",
    description: "Studio collections for the shared-universe libraries: Marvel, Lucasfilm, Legendary.",
    type: "studios",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
  },
  {
    slug: "by-country",
    name: "World Cinema",
    description: "A collection per country of origin from TMDb production-country data.",
    type: "countries",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "kid-safe",
    name: "Kid-Safe Ratings",
    description: "Collections by content rating (G, PG, TV-Y, TV-G) so the safe stuff is one tap away.",
    type: "content_ratings",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "auteur-directors",
    name: "Auteur Directors",
    description: "A shelf per director from TMDb crew data — the closest thing to a director's section.",
    type: "directors",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
  },
  {
    slug: "by-network",
    name: "By Network",
    description: "One collection per TV network. TV libraries only.",
    type: "networks",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
    mediaTypes: ["show"],
  },
  {
    slug: "streaming-originals",
    name: "Streaming Originals",
    description: "Netflix, Disney+, Apple TV+ and friends, split out from the rest of the library.",
    type: "streaming",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
    mediaTypes: ["show"],
  },
  {
    slug: "based-on",
    name: "Adapted From",
    description: "Group by source material — novel, comic, true story, video game, play, short story.",
    type: "based_on",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
  },
  {
    slug: "franchises",
    name: "Franchises",
    description: "A collection per movie franchise from TMDb. Pairs well with the arr action to fill gaps.",
    type: "tmdb_franchises",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "mosaic" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "award-winners",
    name: "Award Winners",
    description:
      "Oscar, Golden Globe and BAFTA winners, from the awards OMDb lists for each film. Needs an OMDb API key.",
    type: "awards",
    config: {
      pinToHomepage: true,
      pinRotationCount: 10,
      pinMinItems: 3,
      presentation: { poster: "gradient", accentColor: "#D4A017" },
    },
  },
  {
    slug: "tv-award-winners",
    name: "Emmy & Globe Winners",
    description:
      "Emmy, Golden Globe and BAFTA winners, from the awards OMDb lists for each show. Needs an OMDb API key.",
    type: "awards",
    config: {
      pinToHomepage: true,
      pinRotationCount: 10,
      pinMinItems: 3,
      presentation: { poster: "gradient", accentColor: "#D4A017" },
    },
    mediaTypes: ["show"],
  },
  {
    slug: "seasonal-picks",
    name: "Halloween Picks",
    description: "Films TMDb files under Halloween, on the shelf through October and gone in November.",
    type: "seasonal",
    config: {
      // The seasonal type builds every holiday it knows; this rule is the
      // Halloween one, and only in October — it used to sit on Home all year
      // with a Christmas and a Valentine's row beside it.
      includeValues: ["Halloween"],
      schedule: { activeFrom: "10-01", activeTo: "10-31" },
      pinToHomepage: true,
      pinRotationCount: 10,
      pinMinItems: 3,
      presentation: { poster: "gradient", accentColor: "#EA580C" },
    },
  },
  {
    slug: "by-audio-language",
    name: "By Audio Language",
    description: "Group by primary audio stream language, read straight from Plex media info.",
    type: "audio_languages",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "atmos-and-surround",
    name: "Big Audio",
    description: "Audio-language shelves for the demo library — useful next to the format collections.",
    type: "audio_languages",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "by-subtitle-language",
    name: "Subtitled Cinema",
    description: "Group by available subtitle language. The practical half of a world-cinema shelf.",
    type: "subtitle_languages",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "resolutions",
    name: "4K Showcase",
    description: "Plex's reported resolution, split into 4K / 1080p / 720p / SD.",
    type: "resolutions",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
    mediaTypes: ["movie"],
  },
  {
    slug: "video-formats",
    name: "HDR & Source Formats",
    description: "Bluray, WEB-DL, HDTV and friends, inferred from Plex media metadata.",
    type: "video_formats",
    config: { pinToHomepage: true, pinRotationCount: 10, pinMinItems: 3, presentation: { poster: "gradient" } },
    mediaTypes: ["movie"],
  },
];
