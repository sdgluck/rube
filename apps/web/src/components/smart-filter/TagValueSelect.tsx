import { fieldDef, fieldKind } from "@rube/contracts";
import { trpc } from "#/trpc";

export interface TagOption {
  key: string;
  title: string;
}

/**
 * Which form of a tag the surrounding editor stores.
 *
 * The collection editor emits a Plex `content` URI, which only accepts
 * per-server numeric tag keys — `"key"`. Rules are portable across servers and
 * store display names, which `domains/registry/src/resolve.ts` translates to
 * keys at run time — `"title"`. Either way the user only ever sees the title.
 */
export type TagValueMode = "key" | "title";

/**
 * Plex serves a section's tag values under the bare field name, so a
 * scope-qualified field has to be asked for by its base: `show.genre` is
 * still `/library/sections/:id/genre`.
 */
export function tagLookupField(field: string): string {
  return fieldDef(field)?.field ?? field;
}

/**
 * Shared lookup of a section's values for a tag field. tRPC dedupes on the
 * query key, so every row and chip on a page shares one request per field.
 */
export function useTagOptions(sectionId: string | null, field: string): TagOption[] {
  const query = trpc.collections.filterFieldValues.useQuery(
    { sectionId: sectionId ?? "", field: tagLookupField(field) },
    { enabled: !!sectionId && fieldKind(field) === "tag", staleTime: 5 * 60_000 },
  );
  return query.data ?? [];
}

/**
 * Facets small enough to fetch wholesale just to label a summary. `actor` is
 * deliberately absent — a large library has tens of thousands of them, far too
 * much to pull down to prettify a table cell, so actor keys stay unresolved
 * outside the editors (which fetch one field at a time, on demand).
 */
const SUMMARY_TAG_FIELDS = new Set([
  "genre",
  "network",
  "studio",
  "country",
  "contentRating",
  "resolution",
  "label",
  "collection",
  "director",
  "writer",
]);

/**
 * Key → title for the tag fields used across a set of filters, in one request
 * spanning every section. Returns a resolver that leaves anything it can't
 * translate untouched.
 */
export function useTagLabels(fields: string[]): (field: string, value: string) => string {
  const tagFields = [...new Set(fields.map(tagLookupField).filter((f) => SUMMARY_TAG_FIELDS.has(f)))].sort();
  const query = trpc.collections.filterFieldValuesBatch.useQuery(
    { fields: tagFields },
    { enabled: tagFields.length > 0, staleTime: 5 * 60_000 },
  );

  return (field, value) => query.data?.[tagLookupField(field)]?.[value] ?? value;
}

/** The human title for a stored value, in either storage mode. */
export function tagTitle(options: TagOption[], value: string): string {
  const hit = options.find((o) => o.key === value || o.title === value);
  return hit?.title ?? value;
}

export default function TagValueSelect({
  field,
  value,
  sectionId,
  mode = "key",
  className,
  onChange,
}: {
  field: string;
  value: string;
  sectionId: string | null;
  mode?: TagValueMode;
  className?: string;
  onChange: (value: string) => void;
}) {
  const options = useTagOptions(sectionId, field);

  // No section (the rule wizard before a library is picked) or Plex has no
  // values for this facet — fall back to free text rather than trapping the
  // user in an empty dropdown.
  if (options.length === 0) {
    return <input type="text" className={className} value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  const valueOf = (o: TagOption) => (mode === "key" ? o.key : o.title);
  const known = options.some((o) => valueOf(o) === value);

  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {/* An imported value we can't match — a key from another server, or a
          tag since renamed. Show it as-is so saving doesn't silently drop it. */}
      {!known && value && <option value={value}>{tagTitle(options, value)}</option>}
      {!value && <option value="">Choose…</option>}
      {options.map((o) => (
        <option key={o.key} value={valueOf(o)}>
          {o.title}
        </option>
      ))}
    </select>
  );
}
