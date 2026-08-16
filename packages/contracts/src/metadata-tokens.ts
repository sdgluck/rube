/**
 * Templating for metadata writes.
 *
 * This is what makes `set` useful rather than a bulk-overwrite footgun. "Set
 * every Marvel film's sort title to `Marvel {year} {title}`" is a smart filter
 * plus one action; "set every Marvel film's sort title to the same string" is
 * a way to break a library.
 *
 * Deliberately a small, closed token set rather than a general template
 * language. Three reasons: an unknown token has to be an error at *save* time
 * (a rule that writes the literal text "{titel}" into 400 titles is a bad day),
 * every token has to be answerable from what the rule already knows about an
 * item, and this expression runs once per item per field over thousands of
 * items.
 *
 * Pure and dependency-free so both the wizard and the job can use it — the
 * wizard to validate and preview, the job to apply.
 */

/** The tokens a metadata template may use. */
export const METADATA_TOKENS = ["title", "year", "sortableTitle", "collection", "originalTitle", "studio"] as const;

export type MetadataToken = (typeof METADATA_TOKENS)[number];

/** What each token resolves to, per item. Missing values expand to "". */
export interface TokenContext {
  title?: string;
  year?: number | string;
  /** The collection the rule is building, when there is one. */
  collection?: string;
  originalTitle?: string;
  studio?: string;
}

/**
 * Articles stripped by `{sortableTitle}`, by language.
 *
 * English only by default, and that is a deliberate limit rather than an
 * oversight: stripping "La" from a French library is right, and stripping it
 * from "La Bamba" in an English one is wrong, so the caller says which
 * languages its library is in. An unrecognised language contributes nothing
 * rather than throwing — a typo in a language list must not stop a rule from
 * running, it just leaves the titles alone.
 */
export const SORT_ARTICLES: Record<string, readonly string[]> = {
  en: ["the", "a", "an"],
  es: ["el", "la", "los", "las", "un", "una"],
  fr: ["le", "la", "les", "un", "une", "des", "l'"],
  de: ["der", "die", "das", "ein", "eine"],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una"],
  nl: ["de", "het", "een"],
};

export const DEFAULT_SORT_LANGUAGES: readonly string[] = ["en"];

/**
 * A title with its leading article moved out of the way.
 *
 * "The Matrix" → "Matrix, The". Plex sorts on the raw string, so this is the
 * single most common complaint the whole feature exists to answer.
 *
 * The comma form rather than plain removal, because "Matrix" and "Matrix, The"
 * are distinguishable at a glance in the Plex UI and "Matrix" alone reads as a
 * different film. A title that is *only* an article ("The") is left alone —
 * "​, The" is not a sort title.
 */
export function sortableTitle(title: string, languages: readonly string[] = DEFAULT_SORT_LANGUAGES): string {
  const trimmed = title.trim();
  const articles = new Set(languages.flatMap((lang) => SORT_ARTICLES[lang.toLowerCase()] ?? []));
  if (articles.size === 0) return trimmed;

  // Apostrophe articles ("L'Avventura") carry no following space, so they are
  // matched on the prefix rather than on a word split.
  for (const article of articles) {
    if (!article.endsWith("'")) continue;
    if (trimmed.toLowerCase().startsWith(article) && trimmed.length > article.length) {
      return `${trimmed.slice(article.length)}, ${trimmed.slice(0, article.length)}`;
    }
  }

  const space = trimmed.indexOf(" ");
  if (space <= 0) return trimmed;
  const first = trimmed.slice(0, space);
  if (!articles.has(first.toLowerCase())) return trimmed;
  const rest = trimmed.slice(space + 1).trim();
  // "The" on its own, or "The " with nothing after it.
  if (!rest) return trimmed;
  return `${rest}, ${first}`;
}

const TOKEN_PATTERN = /\{([^{}]*)\}/g;

/** Tokens a template names that this expander does not know. */
export function unknownTokens(template: string): string[] {
  const known = new Set<string>(METADATA_TOKENS);
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const name = match[1].trim();
    if (!known.has(name)) found.add(match[1]);
  }
  return [...found];
}

/**
 * Why this template can't be saved, or null if it can.
 *
 * An unknown token is rejected here rather than expanded to a literal, because
 * the failure mode of the alternative is a rule that runs clean and writes
 * "{titel}" into four hundred titles.
 */
export function templateError(template: string): string | null {
  const unknown = unknownTokens(template);
  if (unknown.length === 0) return null;
  const list = unknown.map((t) => `{${t}}`).join(", ");
  return `Unknown token${unknown.length > 1 ? "s" : ""} ${list}. Available: ${METADATA_TOKENS.map((t) => `{${t}}`).join(", ")}.`;
}

/**
 * Expand a template against one item.
 *
 * A token with no value expands to the empty string, and the result is
 * whitespace-collapsed afterwards — a film with no year under
 * `"{collection} {year} {title}"` should read "Marvel Iron Man", not
 * "Marvel  Iron Man". Throws on an unknown token: by the time a job is
 * expanding templates the config has already been validated, so reaching one
 * here means something bypassed `templateError` and writing the literal would
 * be worse than failing.
 */
export function expandTemplate(
  template: string,
  ctx: TokenContext,
  opts: { sortLanguages?: readonly string[] } = {},
): string {
  const languages = opts.sortLanguages ?? DEFAULT_SORT_LANGUAGES;
  const title = ctx.title ?? "";

  const expanded = template.replace(TOKEN_PATTERN, (whole, rawName: string) => {
    const name = rawName.trim();
    switch (name) {
      case "title":
        return title;
      case "year":
        return ctx.year == null ? "" : String(ctx.year);
      case "sortableTitle":
        return sortableTitle(title, languages);
      case "collection":
        return ctx.collection ?? "";
      case "originalTitle":
        return ctx.originalTitle ?? "";
      case "studio":
        return ctx.studio ?? "";
      default:
        throw new Error(`Unknown metadata token "${whole}"`);
    }
  });

  return expanded.replace(/\s+/g, " ").trim();
}
