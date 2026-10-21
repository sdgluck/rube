/**
 * Making a rule mean the same thing on a different Plex server.
 *
 * One thing inside a smart filter is instance-local: tag values. Plex stores
 * them as numeric keys unique to the server — `genre = "5840"` — so a rule
 * carried to another install runs cleanly and matches nothing. Not an error, no
 * warning, just an empty collection every night.
 *
 * The registry solved this in one direction: packs publish display names and
 * `domains/registry` swaps them for local keys on import. Export needs the
 * inverse, and a second implementation of a walk over the same tree — with the
 * same rules about which fields are tags and which are already keys — is the
 * kind of duplication that stays correct for about a release. So the walk lives
 * here, takes a direction, and both callers use it.
 *
 * Deliberately free of database and Plex-client imports: the lookup arrives as
 * a callback, so this is testable without either.
 */
import { smartFilterGroupSchema, type SmartFilterGroup, type SmartFilterNode } from "@rube/plex-smart-filter";

import { isTagField } from "./rule-config.ts";

/** `(sectionId, field) -> [{key, title}]`, i.e. `client.getFilterFieldValues`. */
export type TagLookup = (sectionId: string, field: string) => Promise<{ key: string; title: string }[]>;

/**
 * `toKeys` is import — display names in, this server's keys out.
 * `toTitles` is export — keys in, portable names out.
 */
export type TagDirection = "toKeys" | "toTitles";

export interface TagTranslationTarget {
  sectionId: string;
  sectionTitle: string;
}

/** A clause whose value had no counterpart on the other side. */
export interface TagTranslationWarning {
  field: string;
  value: string;
  sectionTitle: string;
}

/**
 * Match key for a tag title.
 *
 * Percent-decoded, because that is how these values are actually stored. A
 * smart filter's value goes into a Plex query string, and the wizard writes
 * some of them pre-encoded — a real install has `show.studio` clauses reading
 * `Amazon%20Studios` and `Sky%20Atlantic`. Comparing those against Plex's
 * `Amazon Studios` verbatim never matches, so a rule that works perfectly well
 * gets reported as an unresolvable clause on every import.
 *
 * `decodeURIComponent` throws on a lone `%`, which a hand-typed value can
 * easily contain, so a value that will not decode is used as-is rather than
 * taking the translation down with it.
 */
function matchKey(value: string): string {
  const trimmed = value.trim();
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // Not valid percent-encoding — it was a literal, and already is the key.
  }
  return decoded.toLowerCase();
}

/**
 * Memoises per `(sectionId, field, direction)`, so a filter with six director
 * clauses makes one Plex call rather than six. Scoped to a single translation
 * so a library retagged between two of them isn't served a stale map.
 */
function createTagMaps(lookup: TagLookup) {
  const cache = new Map<string, Promise<{ byTitle: Map<string, string>; byKey: Map<string, string> }>>();

  return async function translate(
    sectionId: string,
    field: string,
    value: string,
    direction: TagDirection,
  ): Promise<string | null> {
    const cacheKey = `${sectionId}\u0000${field}`;
    let entry = cache.get(cacheKey);
    if (!entry) {
      entry = lookup(sectionId, field)
        .then((values) => ({
          byTitle: new Map(values.map((v) => [matchKey(v.title), v.key])),
          byKey: new Map(values.map((v) => [v.key, v.title])),
        }))
        // A field Plex doesn't expose for this section type, or a transient
        // failure, must not abort the whole operation — it degrades to a
        // warning on the clauses that needed it.
        .catch(() => ({ byTitle: new Map<string, string>(), byKey: new Map<string, string>() }));
      cache.set(cacheKey, entry);
    }
    const maps = await entry;
    return direction === "toKeys"
      ? (maps.byTitle.get(matchKey(value)) ?? null)
      : (maps.byKey.get(value.trim()) ?? null);
  };
}

/** A numeric string is a Plex tag key; anything else is a display name. */
const isTagKey = (value: string): boolean => /^\d+$/.test(value.trim());

async function walk(
  node: SmartFilterNode,
  target: TagTranslationTarget,
  direction: TagDirection,
  translate: ReturnType<typeof createTagMaps>,
  warnings: TagTranslationWarning[],
): Promise<SmartFilterNode> {
  if (node.kind === "group") {
    const children = [];
    for (const child of node.children) children.push(await walk(child, target, direction, translate, warnings));
    return { ...node, children };
  }

  if (!isTagField(node.field)) return node;

  // Already in the shape we want. On import that is a pasted key or a config
  // that has been through here before; on export it is a hand-typed name in a
  // rule that was never resolved. Either way there is nothing to look up, and
  // attempting it would produce a warning about a value that is already right.
  if (direction === "toKeys" ? isTagKey(node.value) : !isTagKey(node.value)) return node;

  const translated = await translate(target.sectionId, node.field, node.value, direction);
  if (translated == null) {
    warnings.push({ field: node.field, value: node.value, sectionTitle: target.sectionTitle });
    return node;
  }
  return { ...node, value: translated };
}

export interface TranslateResult {
  smartFilter: SmartFilterGroup;
  warnings: TagTranslationWarning[];
}

/**
 * Translate every tag clause in a smart filter.
 *
 * Tag keys are per-section, so a filter can only be translated against one
 * section at a time. When a rule is scoped to several, the caller passes the
 * first as `target` and the rest as `alsoWarnAgainst` — those are checked but
 * not written from, so the user sees the whole picture rather than only the
 * first library's. That is the same compromise the rule itself makes: one
 * `smartFilter` runs verbatim across every section it names.
 */
export async function translateSmartFilterTags(
  smartFilter: unknown,
  opts: {
    target: TagTranslationTarget;
    alsoWarnAgainst?: TagTranslationTarget[];
    direction: TagDirection;
    lookup: TagLookup;
  },
): Promise<TranslateResult> {
  const parsed = smartFilterGroupSchema.safeParse(smartFilter);
  if (!parsed.success) throw new Error(`Invalid smart filter: ${parsed.error.message}`);

  const warnings: TagTranslationWarning[] = [];
  const translate = createTagMaps(opts.lookup);
  const translated = (await walk(parsed.data, opts.target, opts.direction, translate, warnings)) as SmartFilterGroup;

  for (const other of opts.alsoWarnAgainst ?? []) {
    await walk(parsed.data, other, opts.direction, translate, warnings);
  }

  return { smartFilter: translated, warnings };
}
