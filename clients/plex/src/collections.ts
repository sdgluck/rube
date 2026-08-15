import PQueue from "p-queue";
import { PlexApiError, type PlexHttp } from "./http.ts";
import {
  PLEX_COLLECTION_TYPE,
  SECTION_TYPE_MAP,
  type PlexItem,
  type PlexCollection,
  type PlexCollectionDetail,
  type PlexLabel,
} from "./types.ts";

/**
 * Bounds for the label sweep that precedes a rule's regeneration. Both are
 * per call, not module-scoped: a sweep is one section's worth of work and the
 * caller (one rule, one section at a time) is already the serialising force.
 */
const LABEL_LOOKUP_CONCURRENCY = 8;
const DELETE_CONCURRENCY = 4;

/** True for the 404 Plex returns once a ratingKey no longer exists. */
function isGone(err: unknown): boolean {
  return err instanceof PlexApiError && err.status === 404;
}

export function createCollectionsModule(http: PlexHttp) {
  /**
   * `label` narrows the listing server-side to collections carrying that exact
   * tag. Verified against Plex 1.42: matching is exact (`Rule:` on its own
   * matches nothing, so one rule's filter can never catch another's) and
   * case-insensitive, and an unknown tag returns an empty set rather than
   * everything — the failure mode a delete path needs.
   *
   * The listing itself does not carry each entry's labels, whatever you ask
   * for (`includeLabels=1` changes nothing), which is why the `labels` field
   * is usually absent and callers needing it must fetch per collection.
   */
  async function getCollections(sectionId: string, opts?: { label?: string }): Promise<PlexCollection[]> {
    const data = await http.request(`/library/sections/${sectionId}/all`, {
      params: {
        type: PLEX_COLLECTION_TYPE,
        ...(opts?.label ? { label: opts.label } : {}),
      },
    });
    const metadata: Array<Record<string, unknown>> = data?.MediaContainer?.Metadata || [];
    return metadata.map((col) => ({
      ...(col as unknown as PlexCollection),
      labels: Array.isArray(col.Label) ? (col.Label as PlexLabel[]).map((l) => l.tag) : undefined,
    }));
  }

  async function getCollectionLabels(ratingKey: string): Promise<PlexLabel[]> {
    const detail = await http.request(`/library/metadata/${ratingKey}`);
    return detail?.MediaContainer?.Metadata?.[0]?.Label || [];
  }

  async function deleteItem(ratingKey: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}`, { method: "DELETE" });
  }

  /** Delete, treating an already-deleted key as success. Reports whether we did it. */
  async function deleteItemIfPresent(ratingKey: string): Promise<boolean> {
    try {
      await deleteItem(ratingKey);
      return true;
    } catch (err) {
      if (isGone(err)) return false;
      throw err;
    }
  }

  async function getCollectionDetail(ratingKey: string): Promise<PlexCollectionDetail> {
    const detail = await http.request(`/library/metadata/${ratingKey}`);
    const meta = detail?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    return {
      ratingKey: meta.ratingKey,
      title: meta.title,
      summary: meta.summary || "",
      childCount: meta.childCount || 0,
      thumb: meta.thumb || "",
      labels: (meta.Label || []).map((l: PlexLabel) => l.tag),
      smart: meta.smart === "1" || meta.smart === 1 || meta.smart === true,
      content: meta.content || "",
      addedAt: meta.addedAt,
    };
  }

  /**
   * `known.smart === false` skips the metadata probe below. Callers that have
   * just fetched the detail (or just created the collection) already know the
   * answer, and the probe is a third of the requests in a collection commit.
   */
  async function getCollectionChildren(ratingKey: string, known?: { smart: boolean }): Promise<PlexItem[]> {
    // Smart collections don't serve items via /children — they use a dynamic
    // query path stored in the metadata's key field.
    let meta: { smart?: unknown; key?: string } | undefined;
    let isSmart = known?.smart ?? false;
    if (known?.smart !== false) {
      const detail = await http.request(`/library/metadata/${ratingKey}`);
      meta = detail?.MediaContainer?.Metadata?.[0];
      isSmart = meta?.smart === "1" || meta?.smart === 1 || meta?.smart === true;
    }

    let metadata;
    if (isSmart && meta?.key) {
      const data = await http.request(meta.key);
      metadata = data?.MediaContainer?.Metadata || [];
    } else {
      const data = await http.request(`/library/metadata/${ratingKey}/children`);
      metadata = data?.MediaContainer?.Metadata || [];
    }

    return metadata.map((item: { ratingKey: string; title: string; year?: number; thumb?: string }) => ({
      ratingKey: item.ratingKey,
      title: item.title,
      year: item.year,
      thumb: item.thumb,
    }));
  }

  async function updateCollection(ratingKey: string, updates: { title?: string; summary?: string }): Promise<void> {
    const params: Record<string, string> = {};
    if (updates.title !== undefined) params.title = updates.title;
    if (updates.summary !== undefined) params.summary = updates.summary;
    await http.request(`/library/metadata/${ratingKey}`, { method: "PUT", params });
  }

  /**
   * A section's collections with their labels definitively resolved.
   *
   * "List a section, then ask each collection for its labels" is the shape of
   * every label-driven sweep in the app, and since the listing won't hand over
   * labels, that's a request per collection — on a library with a few hundred
   * of them, per section, per job. Two things make it bearable: `opts.label`
   * pushes the filter into the listing so only real candidates are asked
   * after, and what's left is asked in parallel rather than one at a time.
   *
   * The label a listing was filtered by is still re-checked by callers against
   * what comes back, so a Plex build that ignored the filter would be slow
   * rather than wrong.
   *
   * A collection that has vanished since the listing is dropped: the listing is
   * a snapshot, and with several rules generating into one section at once, a
   * sibling deleting its own collections mid-walk is routine rather than an
   * error.
   */
  async function getCollectionsWithLabels(
    sectionId: string,
    opts?: { label?: string },
  ): Promise<Array<PlexCollection & { labels: string[] }>> {
    const collections = await getCollections(sectionId, opts);
    const resolved: Array<PlexCollection & { labels: string[] }> = [];
    const unresolved: PlexCollection[] = [];

    for (const col of collections) {
      if (col.labels) resolved.push({ ...col, labels: col.labels });
      else unresolved.push(col);
    }

    const lookups = new PQueue({ concurrency: LABEL_LOOKUP_CONCURRENCY });
    await Promise.all(
      unresolved.map((col) =>
        lookups.add(async () => {
          try {
            const labels = await getCollectionLabels(col.ratingKey);
            resolved.push({ ...col, labels: labels.map((l) => l.tag) });
          } catch (err) {
            if (isGone(err)) return;
            throw err;
          }
        }),
      ),
    );

    return resolved;
  }

  /**
   * Returns the rating keys actually deleted, not just how many. Callers need
   * the keys to evict the matching rows from the local collections cache —
   * a Plex-side delete that leaves its row behind shows up in the UI as a
   * collection that still exists.
   */
  async function deleteCollectionsByLabel(sectionId: string, label: string): Promise<string[]> {
    const wanted = label.toLowerCase();
    // Filtered server-side, then checked again here: the filter is what makes
    // this cheap, and the check is what makes it safe to rely on.
    const collections = await getCollectionsWithLabels(sectionId, { label });
    const matched = collections.filter((col) => col.labels.some((tag) => tag.toLowerCase() === wanted));

    const deletes = new PQueue({ concurrency: DELETE_CONCURRENCY });
    const deleted: string[] = [];
    await Promise.all(
      matched.map((col) =>
        deletes.add(async () => {
          // A key already gone by the time we reach it isn't a failure — it's
          // already in the state we wanted — but it isn't ours to report.
          if (await deleteItemIfPresent(col.ratingKey)) deleted.push(col.ratingKey);
        }),
      ),
    );
    return deleted;
  }

  async function createCollectionWithLabel(
    sectionId: string,
    sectionType: string,
    machineId: string,
    name: string,
    ratingKeys: string[],
    labels: string | string[],
  ): Promise<string | null> {
    if (ratingKeys.length === 0) return null;

    const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;

    const data = await http.request("/library/collections", {
      method: "POST",
      params: {
        type: SECTION_TYPE_MAP[sectionType] || 1,
        title: name,
        smart: 0,
        sectionId,
        uri,
      },
    });

    const collectionKey = data?.MediaContainer?.Metadata?.[0]?.ratingKey;
    if (!collectionKey) throw new Error(`Failed to create collection "${name}"`);

    const labelArray = Array.isArray(labels) ? labels : [labels];
    const labelParams: Record<string, string | number> = {
      type: PLEX_COLLECTION_TYPE,
      id: collectionKey,
      "label.locked": 1,
    };
    for (let i = 0; i < labelArray.length; i++) {
      labelParams[`label[${i}].tag.tag`] = labelArray[i];
    }

    await http.request(`/library/sections/${sectionId}/all`, {
      method: "PUT",
      params: labelParams,
    });

    return collectionKey;
  }

  async function setCollectionLabels(_sectionId: string, ratingKey: string, labels: string[]): Promise<void> {
    const labelParams: Record<string, string | number> = {
      "label.locked": 1,
    };
    for (let i = 0; i < labels.length; i++) {
      labelParams[`label[${i}].tag.tag`] = labels[i];
    }
    await http.request(`/library/metadata/${ratingKey}`, { method: "PUT", params: labelParams });
  }

  async function getSmartCollectionContent(ratingKey: string): Promise<{ content: string; key: string }> {
    const detail = await http.request(`/library/metadata/${ratingKey}`);
    const meta = detail?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    return { content: meta.content || "", key: meta.key || "" };
  }

  async function updateSmartCollectionContent(ratingKey: string, contentUri: string): Promise<void> {
    await http.request(`/library/collections/${ratingKey}/items`, {
      method: "PUT",
      params: { uri: contentUri },
    });
  }

  return {
    getCollections,
    getCollectionsWithLabels,
    getCollectionLabels,
    deleteItem,
    getCollectionDetail,
    getCollectionChildren,
    updateCollection,
    deleteCollectionsByLabel,
    createCollectionWithLabel,
    setCollectionLabels,
    getSmartCollectionContent,
    updateSmartCollectionContent,
  };
}
