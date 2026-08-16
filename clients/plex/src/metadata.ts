/**
 * Reading and writing an item's own metadata — title, sort title, summary,
 * content rating, and the tag sets Plex keeps alongside them.
 *
 * Two things about Plex make this less obvious than it looks.
 *
 * **Writes go to the section endpoint, not the item.** `PUT
 * /library/metadata/:key` answers 200 for a library item and applies nothing —
 * the same trap `addItemLabel` documents. The form Plex's own web client uses
 * is `PUT /library/sections/:id/all?type=<n>&id=<ratingKey>&title.value=…`,
 * and it is the one that reliably honours locks.
 *
 * **Every field carries a lock.** Writing a field without locking it means the
 * next agent refresh may revert it, so Tinkerbell would appear to work and then
 * silently undo itself. Writing *with* the lock means Plex stops updating that
 * field from metadata agents until someone unlocks it. Both are real choices,
 * so `lock` is an explicit argument with no default at this layer — the
 * defaulting belongs to the config schemas above, where a user can see it.
 */
import type { PlexHttp } from "./http.ts";
import { SECTION_TYPE_MAP } from "./types.ts";

/**
 * The scalar fields Tinkerbell can write. Deliberately a closed set: Plex
 * accepts anything of the form `<field>.value`, and a typo in an open-ended
 * field name is a write that answers 200 and changes nothing.
 */
export const METADATA_FIELDS = [
  "title",
  "titleSort",
  "summary",
  "tagline",
  "contentRating",
  "studio",
  "originallyAvailableAt",
  "year",
] as const;

export type MetadataField = (typeof METADATA_FIELDS)[number];

export type MetadataFields = Partial<Record<MetadataField, string>>;

export function isMetadataField(field: string): field is MetadataField {
  return (METADATA_FIELDS as readonly string[]).includes(field);
}

/**
 * Tag fields, which take the indexed `genre[0].tag.tag=…` form rather than a
 * scalar `.value`. Different enough to deserve their own function rather than
 * being smuggled into the field writer.
 */
export const METADATA_TAG_FIELDS = ["genre", "collection", "label", "director", "writer"] as const;

export type MetadataTagField = (typeof METADATA_TAG_FIELDS)[number];

export function isMetadataTagField(field: string): field is MetadataTagField {
  return (METADATA_TAG_FIELDS as readonly string[]).includes(field);
}

/** An item's current metadata, plus which of its fields Plex has locked. */
export interface ItemFields {
  ratingKey: string;
  title: string;
  type: string;
  fields: MetadataFields;
  tags: Partial<Record<MetadataTagField, string[]>>;
  /** Field names Plex reports as locked — scalar and tag fields alike. */
  locked: string[];
}

/**
 * Plex returns per-item lock state as a `Field` array of `{ name, locked }`.
 * Older servers omit it entirely, which reads here as "nothing is locked" —
 * the safe direction, because the guard rails that consult this treat an
 * unknown lock as absent and simply do the write the user asked for.
 */
function parseLocked(meta: Record<string, unknown>): string[] {
  const fields = meta.Field;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f): f is { name: string; locked?: boolean | number } => !!f && typeof f.name === "string")
    .filter((f) => f.locked === true || f.locked === 1)
    .map((f) => f.name);
}

function tagList(meta: Record<string, unknown>, key: string): string[] {
  const raw = meta[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { tag: string } => !!t && typeof (t as { tag?: unknown }).tag === "string")
    .map((t) => t.tag);
}

/** Plex's capitalised container key for each tag field. */
const TAG_CONTAINER: Record<MetadataTagField, string> = {
  genre: "Genre",
  collection: "Collection",
  label: "Label",
  director: "Director",
  writer: "Writer",
};

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function createMetadataModule(http: PlexHttp) {
  function typeNumber(sectionType: string): number {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);
    return typeNum;
  }

  /**
   * Everything we might write, as it stands right now, plus the lock state.
   *
   * Read before every write. Plex writes are not free, and a nightly job that
   * PUTs 5,000 unchanged items is both slow and indistinguishable from one
   * that is broken.
   */
  async function getItemFields(ratingKey: string): Promise<ItemFields> {
    const data = await http.request(`/library/metadata/${ratingKey}`, { params: { includeFields: 1 } });
    const meta = data?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);

    const fields: MetadataFields = {};
    for (const field of METADATA_FIELDS) {
      const value = str(meta[field]);
      if (value !== undefined) fields[field] = value;
    }

    const tags: Partial<Record<MetadataTagField, string[]>> = {};
    for (const field of METADATA_TAG_FIELDS) {
      tags[field] = tagList(meta, TAG_CONTAINER[field]);
    }

    return {
      ratingKey: str(meta.ratingKey) ?? ratingKey,
      title: str(meta.title) ?? "",
      type: str(meta.type) ?? "",
      fields,
      tags,
      locked: parseLocked(meta),
    };
  }

  /**
   * Write scalar fields, with the lock intent the caller specifies.
   *
   * Returns the fields that were actually sent. An unchanged value produces no
   * HTTP call at all — but a value that matches while the *lock* state differs
   * still does, because "make this stick" is a change even when the text is
   * the same.
   */
  async function updateItemFields(
    sectionId: string,
    sectionType: string,
    ratingKey: string,
    fields: MetadataFields,
    opts: { lock: boolean; current?: ItemFields },
  ): Promise<MetadataField[]> {
    const typeNum = typeNumber(sectionType);
    const current = opts.current ?? (await getItemFields(ratingKey));
    const lockedNow = new Set(current.locked);

    const params: Record<string, string | number> = { type: typeNum, id: ratingKey };
    const written: MetadataField[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const field = key as MetadataField;
      const unchanged = (current.fields[field] ?? "") === value;
      const lockMatches = lockedNow.has(field) === opts.lock;
      if (unchanged && lockMatches) continue;
      params[`${field}.value`] = value;
      params[`${field}.locked`] = opts.lock ? 1 : 0;
      written.push(field);
    }

    if (written.length === 0) return [];
    await http.request(`/library/sections/${sectionId}/all`, { method: "PUT", params });
    return written;
  }

  /**
   * Hand fields back to Plex's agents.
   *
   * The counterpart to a locking write, and not optional: being unable to
   * unlock would make every write a one-way door.
   */
  async function unlockItemFields(
    sectionId: string,
    sectionType: string,
    ratingKey: string,
    fields: readonly string[],
  ): Promise<void> {
    if (fields.length === 0) return;
    const typeNum = typeNumber(sectionType);
    const params: Record<string, string | number> = { type: typeNum, id: ratingKey };
    for (const field of fields) params[`${field}.locked`] = 0;
    await http.request(`/library/sections/${sectionId}/all`, { method: "PUT", params });
  }

  /**
   * Replace one tag set wholesale.
   *
   * Plex's tag PUT replaces the whole set, so callers that mean "add" must
   * read and resend — `addItemLabel` in `items.ts` is the worked example. The
   * empty array is meaningful and distinct from not calling this at all: it
   * clears the set, which Plex expresses as the indexed parameters being
   * absent while the field is still named by its `.locked` flag.
   */
  async function setItemTags(
    sectionId: string,
    sectionType: string,
    ratingKey: string,
    field: MetadataTagField,
    tags: readonly string[],
    opts: { lock: boolean } = { lock: true },
  ): Promise<void> {
    const typeNum = typeNumber(sectionType);
    const params: Record<string, string | number> = {
      type: typeNum,
      id: ratingKey,
      [`${field}.locked`]: opts.lock ? 1 : 0,
    };
    for (let i = 0; i < tags.length; i++) params[`${field}[${i}].tag.tag`] = tags[i];
    // Clearing a set needs an explicit empty marker: with no indexed
    // parameters at all Plex reads the PUT as "this field wasn't mentioned"
    // and leaves the existing tags in place.
    if (tags.length === 0) params[`${field}[].tag.tag`] = "";
    await http.request(`/library/sections/${sectionId}/all`, { method: "PUT", params });
  }

  /** Ask Plex to re-run its agents against one item. */
  async function refreshItem(ratingKey: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}/refresh`, { method: "PUT" });
  }

  /**
   * Re-match an item to a specific provider id.
   *
   * Here because a manual re-match from the UI is cheap and the wrong-match
   * case is common. Deciding *automatically* that a match looks wrong is a
   * research problem and deliberately not attempted.
   */
  async function matchItem(ratingKey: string, guid: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}/match`, { method: "PUT", params: { guid } });
  }

  return { getItemFields, updateItemFields, unlockItemFields, setItemTags, refreshItem, matchItem };
}
