/**
 * How a generated collection presents itself in Plex: its summary and its
 * poster.
 *
 * Lives in contracts because four places have to agree on it and none of them
 * can import the others — the generate job writes the summary, the
 * `collection-art` command renders the poster, the wizard edits the config,
 * and the registry build validates published packs against it before a pack
 * ever reaches somebody's server.
 */
import { z } from "zod";
import type { SmartFilterGroup, SmartFilterNode } from "@tinkerbell/plex-smart-filter";
import { describeCondition } from "./smart-filter-format.ts";
import { narrateSmartFilter, type TagResolver } from "./smart-filter-narrate.ts";

// ─── Poster templates ───────────────────────────────────────────────────────

/**
 * Every poster layout the renderer knows. The rule config names a *choice*
 * (`mosaic`), which resolves to one of these at render time based on how many
 * member posters actually turned up — see {@link resolvePosterTemplate}.
 */
export const COLLECTION_POSTER_TEMPLATES = ["gradient", "mosaic-2x2", "mosaic-3x2", "spotlight"] as const;
export type CollectionPosterTemplateId = (typeof COLLECTION_POSTER_TEMPLATES)[number];

/** Plex's expected poster geometry. Every template renders exactly this. */
export const COLLECTION_POSTER_WIDTH = 1000;
export const COLLECTION_POSTER_HEIGHT = 1500;

export const POSTER_SOURCES = ["none", "url", "gradient", "mosaic", "spotlight"] as const;
export type PosterSource = (typeof POSTER_SOURCES)[number];

export const SUMMARY_SOURCES = ["none", "template", "llm", "custom"] as const;
export type SummarySource = (typeof SUMMARY_SOURCES)[number];

/**
 * A `mosaic` rule with three member posters can't fill a 3×2 grid, and a
 * template that renders half-empty looks broken rather than sparse. The choice
 * is resolved from the material, deterministically, so the same inputs always
 * hash to the same `inputHash`.
 */
export function resolvePosterTemplate(source: PosterSource, memberPosterCount: number): CollectionPosterTemplateId {
  if (source === "spotlight") return "spotlight";
  if (source === "mosaic") return memberPosterCount >= 6 ? "mosaic-3x2" : "mosaic-2x2";
  return "gradient";
}

// ─── Poster URL safety ──────────────────────────────────────────────────────

/**
 * Hosts a `posterUrl` may point at.
 *
 * A registry pack is untrusted third-party content that Tinkerbell would
 * otherwise fetch server-side, on a schedule, and hand to `sharp` — which is a
 * decoder with a real CVE history. Restricting the origin to image hosts we
 * already depend on keeps a published pack from turning every installed
 * instance into a request source pointed wherever its author likes.
 *
 * Locally-authored rules go through the same check: an admin who wants an
 * arbitrary host can fetch the image and host it somewhere on this list, and
 * the alternative is a config field that makes the server fetch any URL.
 */
export const POSTER_URL_ALLOWED_HOSTS: readonly string[] = [
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
  "image.tmdb.org",
  "assets.fanart.tv",
  "m.media-amazon.com",
];

export type PosterUrlRejection = "not-a-url" | "not-https" | "host-not-allowed";

/** Why this URL can't be fetched, or null when it's fine. */
export function posterUrlRejection(url: string): PosterUrlRejection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not-a-url";
  }
  if (parsed.protocol !== "https:") return "not-https";
  const host = parsed.hostname.toLowerCase();
  return POSTER_URL_ALLOWED_HOSTS.includes(host) ? null : "host-not-allowed";
}

export function posterUrlError(url: string): string | null {
  switch (posterUrlRejection(url)) {
    case null:
      return null;
    case "not-a-url":
      return `"${url}" is not a URL.`;
    case "not-https":
      return "A poster URL must be HTTPS.";
    case "host-not-allowed":
      return `Poster URLs must be hosted on one of: ${POSTER_URL_ALLOWED_HOSTS.join(", ")}.`;
  }
}

/** Ceiling on a fetched poster, before it reaches an image decoder. */
export const POSTER_MAX_BYTES = 8 * 1024 * 1024;

// ─── Config ─────────────────────────────────────────────────────────────────

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const presentationConfigSchema = z
  .object({
    summary: z.enum(SUMMARY_SOURCES).default("template"),
    customSummary: z.string().max(1000).optional(),
    /**
     * Defaults to `none` deliberately. Uploading artwork to Plex is a visible,
     * hard-to-undo change to someone's server, so the first time is opted into
     * per rule rather than inherited from a default nobody chose.
     */
    poster: z.enum(POSTER_SOURCES).default("none"),
    posterUrl: z.string().optional(),
    /** Overrides the palette derived from member art. */
    accentColor: z.string().regex(HEX_COLOR, "Use a hex colour like #E5A00D").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.summary === "custom" && !value.customSummary?.trim()) {
      ctx.addIssue({ code: "custom", path: ["customSummary"], message: "Write the summary, or pick another source." });
    }
    if (value.poster !== "url") return;
    if (!value.posterUrl?.trim()) {
      ctx.addIssue({ code: "custom", path: ["posterUrl"], message: "A poster URL is required." });
      return;
    }
    const error = posterUrlError(value.posterUrl.trim());
    if (error) ctx.addIssue({ code: "custom", path: ["posterUrl"], message: error });
  });

export type PresentationConfig = z.infer<typeof presentationConfigSchema>;

/** What a rule with no `presentation` block behaves as. */
export const DEFAULT_PRESENTATION: PresentationConfig = {
  summary: "template",
  poster: "none",
};

export function resolvePresentation(config: { presentation?: PresentationConfig } | undefined): PresentationConfig {
  return config?.presentation ?? DEFAULT_PRESENTATION;
}

// ─── Templated summaries ────────────────────────────────────────────────────

export interface CollectionSummaryContext {
  ruleType: string;
  /** The collection's title — for a grouped rule this is the group itself. */
  collectionName: string;
  /** Plex section type: "movie", "show", or anything else. */
  sectionType?: string;
  itemCount?: number;
  /**
   * A summary the source itself supplied. TMDb ships an overview with every
   * franchise, and its prose beats anything we'd assemble from a template.
   */
  sourceSummary?: string;
  /** The rule's parsed config, for the types whose summary depends on it. */
  config?: { smartFilter?: SmartFilterGroup; listProvider?: string; listId?: string; filter?: string };
  /**
   * Turns a per-server tag key into its title. Without one a smart filter's
   * summary says "genre is 1204" — accurate, unreadable, and written to
   * somebody's library. Callers with a Plex client should supply it.
   */
  resolveTag?: TagResolver;
}

/** "Films" / "Series" / "Titles", matching the library this collection is in. */
function plural(sectionType: string | undefined, capitalised = true): string {
  const word = sectionType === "movie" ? "Films" : sectionType === "show" ? "Series" : "Titles";
  return capitalised ? word : word.toLowerCase();
}

/**
 * Field labels start a clause capitalised, which is right in the wizard's
 * review pane and wrong mid-sentence. Only clause starts — the beginning, and
 * whatever follows a connector or an open bracket — are lowered, so tag titles
 * ("Horror", "HBO") keep their capitals.
 */
function lowerClauseStarts(text: string): string {
  return text.replace(/(^|and |or |\()([A-Z])/g, (_m, lead: string, letter: string) => lead + letter.toLowerCase());
}

/** `1980s` → `[1980, 1989]`. Null for anything that isn't a decade label. */
function decadeRange(name: string): [number, number] | null {
  const m = name.trim().match(/^(\d{4})s$/);
  if (!m) return null;
  const start = Number(m[1]);
  return start % 10 === 0 ? [start, start + 9] : null;
}

/**
 * A whole filter tree as one English sentence fragment — "Genre is Horror and
 * Year is at least 2000".
 *
 * Distinct from the wizard's review-pane summary, which joins with uppercase
 * AND/OR because it is a *restatement of the filter*. This one has to read as
 * prose, because it ends up inside a sentence in a collection's description
 * and in the prompt an LLM is asked to write one from.
 */
export function describeSmartFilter(node: SmartFilterNode, isRoot = true, resolveTag?: TagResolver): string {
  if (node.kind === "leaf") {
    const resolved = resolveTag ? [resolveTag(node.field, node.value)] : undefined;
    return describeCondition(node.field, node.op, [node.value], resolved);
  }
  const parts = node.children.map((child) => describeSmartFilter(child, false, resolveTag)).filter(Boolean);
  if (parts.length === 0) return "";
  const joined = parts.join(node.combinator === "all" ? " and " : " or ");
  return isRoot || parts.length === 1 ? joined : `(${joined})`;
}

/**
 * The deterministic summary for a collection, or null when this rule type has
 * nothing honest to say about it.
 *
 * Returning null is a real case and the important one: an unknown rule type
 * must produce *no* summary rather than a half-built sentence. Anything this
 * returns is written to Plex verbatim, and "Films directed by ." is worse than
 * the blank description it replaced.
 */
export function templatedCollectionSummary(input: CollectionSummaryContext): string | null {
  const name = input.collectionName.trim();
  const source = input.sourceSummary?.trim();
  // TMDb's own overview outranks every template below it — it was written by a
  // person about this exact franchise.
  if (source) return source;
  if (!name) return null;

  const many = plural(input.sectionType);
  const manyLower = plural(input.sectionType, false);

  switch (input.ruleType) {
    case "directors":
    case "tmdb_popular_directors":
      return `${many} directed by ${name}.`;
    case "actors":
    case "tmdb_popular_actors":
      return `${many} starring ${name}.`;
    case "studios":
      return `${many} produced by ${name}.`;
    case "networks":
      return `${many} that aired on ${name}.`;
    case "streaming":
      return `${many} from ${name}.`;
    case "genres":
      return `${name} ${manyLower} in the library.`;
    case "countries":
      return `${many} from ${name}.`;
    case "content_ratings":
      return `${many} rated ${name}.`;
    case "decades": {
      const range = decadeRange(name);
      return range ? `${many} released between ${range[0]} and ${range[1]}.` : `${many} from the ${name}.`;
    }
    case "years":
      return /^\d{4}$/.test(name) ? `${many} released in ${name}.` : `${many} from ${name}.`;
    case "resolutions":
      return `${many} available in ${name}.`;
    case "audio_languages":
      return `${many} with ${name} audio.`;
    case "subtitle_languages":
      return `${many} with ${name} subtitles.`;
    case "video_formats":
      return `${many} sourced from ${name}.`;
    case "based_on":
      // The group label is already a sentence fragment — "Based on a Novel".
      return `${many} ${name.toLowerCase()}.`;
    case "seasonal":
      return `${many} for ${name}.`;
    case "awards":
      return `${name}, from the library.`;
    case "tmdb_franchises":
      return `Every ${manyLower.replace(/s$/, "")} in the ${name} franchise that's in the library.`;
    case "top_rated":
      return `The highest-rated ${manyLower} in the library.`;
    case "lowest_rated":
      return `The lowest-rated ${manyLower} in the library.`;
    case "rt_top_rated":
      return `${many} with the best Rotten Tomatoes scores.`;
    case "imdb_chart":
    case "imdb_list":
      return `${many} from the IMDb list "${name}".`;
    case "list_source": {
      const provider = input.config?.listProvider;
      const label =
        provider === "mdblist" ? "MDBList" : provider === "trakt" ? "Trakt" : provider === "imdb" ? "IMDb" : null;
      return label ? `${many} from the ${label} list "${name}".` : `${many} from an external list.`;
    }
    case "seerr_requests":
      return `${many} requested through Overseerr/Jellyseerr.`;
    case "smart_filter": {
      const filter = input.config?.smartFilter;
      if (!filter) return null;
      // Prose first — this ends up under a collection's title in Plex, read by
      // somebody who doesn't know a filter is involved. A tree that doesn't
      // decompose into a sentence gets the clause-by-clause restatement, which
      // is stiff but never wrong about what the filter matches.
      const narrated = narrateSmartFilter(filter, { noun: manyLower, resolveTag: input.resolveTag });
      if (narrated) return narrated;
      const described = describeSmartFilter(filter, true, input.resolveTag);
      return described ? `${many} matching ${lowerClauseStarts(described)}.` : null;
    }
    case "ai_prompt":
      // The AI wrote the collection's name and picked its members; a template
      // would only restate the title. This is what the `llm` source is for.
      return null;
    default:
      return null;
  }
}

/**
 * The summary to write, honouring the rule's configured source. Null means
 * "write nothing" — either the user turned summaries off, or the type has no
 * template and the LLM path (resolved elsewhere, since it's an async call
 * against a provider that may not exist) is the only thing left.
 */
export function resolveCollectionSummary(
  presentation: PresentationConfig,
  context: CollectionSummaryContext,
): { text: string; source: "template" | "custom" } | null {
  if (presentation.summary === "none") return null;
  if (presentation.summary === "custom") {
    const text = presentation.customSummary?.trim();
    return text ? { text, source: "custom" } : null;
  }
  // `llm` still gets the template as its fallback: a provider that's missing,
  // rate-limited, or simply slower than the run shouldn't leave the collection
  // with no description at all.
  const text = templatedCollectionSummary(context);
  return text ? { text, source: "template" } : null;
}
