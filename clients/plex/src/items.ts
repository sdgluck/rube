import type { PlexHttp } from "./http.ts";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
import { plexMetadataRawSchema, parseMetadataArray, type PlexMetadataRaw } from "./schemas.ts";
import {
  SECTION_TYPE_MAP,
  PLEX_EPISODE_TYPE,
  type PlexItem,
  type PlexDirectoryEntry,
  type PlexMediaItem,
  type PlexMediaDetail,
  type PlexMediaInfo,
  type PlexPartInfo,
  type PlexStreamInfo,
  type PlexMediaFullDetail,
  type PlexChildItem,
  type MediaFilters,
} from "./types.ts";

/**
 * Items per label write.
 *
 * Plex's tag PUT takes a comma-separated `id`, and each request costs it a few
 * seconds whatever it carries — so one item per request held personalization's
 * labelling pass to ~3 items/s, ~27 minutes for a 5,000-item library. A hundred
 * keeps the URL around a kilobyte, well inside any proxy's limit.
 */
const LABEL_BATCH_SIZE = 100;

/**
 * Server-side listing filters, as Plex's filter syntax spells them: `label`
 * matches, `label!` excludes. Values are a tag's title or its numeric key.
 */
export type ListingFilters = Partial<Record<"label" | "label!", string>>;

export function createItemsModule(http: PlexHttp) {
  async function* allItems(
    sectionId: string,
    opts?: { includeGuids?: boolean; type?: number; filters?: ListingFilters },
  ): AsyncGenerator<{ item: PlexMetadataRaw; totalSize: number }> {
    const pageSize = 100;
    let offset = 0;

    while (true) {
      const data = await http.request(`/library/sections/${sectionId}/all`, {
        params: {
          "X-Plex-Container-Start": offset,
          "X-Plex-Container-Size": pageSize,
          ...(opts?.includeGuids ? { includeGuids: 1 } : {}),
          // A section listing returns its top-level rows — shows, not episodes.
          // `type` asks for a different level of the same library, which is the
          // only way to reach the rows that actually carry the files.
          ...(opts?.type ? { type: opts.type } : {}),
          ...opts?.filters,
        },
      });

      const batch = parseMetadataArray(data?.MediaContainer?.Metadata);
      const rawLen = Array.isArray(data?.MediaContainer?.Metadata) ? data.MediaContainer.Metadata.length : 0;
      if (rawLen === 0) break;

      // `totalSize` is what Plex says the section holds. When it is missing,
      // don't take 0 for it: `offset >= 0` is true immediately, so the walk
      // stopped after one page and reported a library of 100 items as complete —
      // plausible, and wrong, which is the worst combination for a figure like
      // "how much storage do my shows take". Falling back to the page length
      // means paging continues until a short page ends it.
      const reportedTotal: number | undefined = data?.MediaContainer?.totalSize;
      const totalSize: number = typeof reportedTotal === "number" ? reportedTotal : offset + rawLen;

      for (const item of batch) {
        yield { item, totalSize };
      }

      offset += rawLen;
      // A short page is the end of the listing whatever the total claimed.
      if (rawLen < pageSize) break;
      if (typeof reportedTotal === "number" && offset >= reportedTotal) break;
    }
  }

  /**
   * Bytes on disk per show in a TV section, summed from that show's episodes.
   *
   * The only way to answer "how much room does this library take" for TV. Plex
   * hangs no `Media` off a show row, so the section listing a sync walks has
   * nothing to add up; the files belong to the episodes.
   *
   * One paged walk of the section at episode level, not a request per show:
   * every episode row carries both its parts and its `grandparentRatingKey`, so
   * a 700-show library costs ~200 pages instead of ~5,000 `/children` calls. It
   * is a second walk of the same library, which is why the caller does it once
   * per sync and only for sections that need it.
   *
   * `episodes` counts the rows seen and `unsized` those Plex gave no size for,
   * so a caller can tell "this show has no files" from "we couldn't tell".
   */
  async function showSizes(
    sectionId: string,
    onProgress?: (walked: number, total: number) => void,
  ): Promise<Map<string, { bytes: number; episodes: number; unsized: number }>> {
    const sizes = new Map<string, { bytes: number; episodes: number; unsized: number }>();
    let walked = 0;
    for await (const { item, totalSize } of allItems(sectionId, { type: PLEX_EPISODE_TYPE })) {
      walked++;
      if (onProgress) onProgress(walked, totalSize);
      const showKey = item.grandparentRatingKey;
      if (!showKey) continue;

      let bytes = 0;
      let sized = false;
      for (const version of item.Media ?? []) {
        for (const part of version.Part ?? []) {
          if (typeof part.size === "number") {
            bytes += part.size;
            sized = true;
          }
        }
      }

      const entry = sizes.get(showKey) ?? { bytes: 0, episodes: 0, unsized: 0 };
      entry.bytes += bytes;
      entry.episodes++;
      if (!sized) entry.unsized++;
      sizes.set(showKey, entry);
    }
    return sizes;
  }

  async function fetchAllItems(sectionId: string): Promise<PlexItem[]> {
    const items: PlexItem[] = [];
    for await (const { item } of allItems(sectionId)) {
      items.push({
        ratingKey: item.ratingKey ?? "",
        title: item.title ?? "",
        year: item.year,
      });
    }
    return items;
  }

  async function fetchItemsSorted(sectionId: string, sort: string, limit: number): Promise<PlexItem[]> {
    const data = await http.request(`/library/sections/${sectionId}/all`, {
      params: {
        sort,
        "X-Plex-Container-Size": limit,
      },
    });
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((item: Record<string, unknown>) => ({
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
    }));
  }

  async function fetchGroupedByField(sectionId: string, field: string, limit: number): Promise<PlexDirectoryEntry[]> {
    const data = await http.request(`/library/sections/${sectionId}/${field}`);
    const dirs: Array<Record<string, unknown>> = data?.MediaContainer?.Directory || [];
    const entries = dirs.map((d) => ({
      tag: d.title as string,
      count: (d.size as number) || (d.childCount as number) || 0,
      key: d.key as string,
    }));
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, limit);
  }

  async function fetchItemsByFilter(filterPath: string): Promise<PlexItem[]> {
    const data = await http.request(filterPath);
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((item: Record<string, unknown>) => ({
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
    }));
  }

  /**
   * How many items a filter matches, without fetching any of them.
   *
   * The funnel asks this once per clause per section, so it must not pay for
   * the rows: `X-Plex-Container-Size=0` returns the `totalSize` header and an
   * empty body. A six-clause rule over three libraries is eighteen of these,
   * which is only affordable because each one is a count rather than a page.
   */
  async function countItemsByFilter(filterPath: string): Promise<number> {
    const joiner = filterPath.includes("?") ? "&" : "?";
    const data = await http.request(`${filterPath}${joiner}X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
    return data?.MediaContainer?.totalSize ?? 0;
  }

  async function allItemsWithGuids(sectionId: string): Promise<
    Array<{
      ratingKey: string;
      title: string;
      year?: number;
      guids: string[];
    }>
  > {
    const results: Array<{ ratingKey: string; title: string; year?: number; guids: string[] }> = [];
    for await (const { item } of allItems(sectionId, { includeGuids: true })) {
      results.push({
        ratingKey: item.ratingKey ?? "",
        title: item.title ?? "",
        year: item.year,
        guids: (item.Guid ?? []).map((g) => g.id),
      });
    }
    return results;
  }

  /**
   * How many items a section holds, without paging through it.
   *
   * Plex reports `totalSize` on any listing, so a request for a single item is
   * enough. The cleanup sanity check needs a denominator for every section on
   * every run, and walking a 20,000-item library to count it would cost more
   * than the rule it is guarding.
   */
  async function getSectionItemCount(sectionId: string, filters?: ListingFilters): Promise<number> {
    const data = await http.request(`/library/sections/${sectionId}/all`, {
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 0, ...filters },
    });
    return data?.MediaContainer?.totalSize ?? 0;
  }

  /** Provider ids (`tmdb://…`, `imdb://…`) for one item. */
  async function getItemGuids(ratingKey: string): Promise<string[]> {
    const data = await http.request(`/library/metadata/${ratingKey}`, { params: { includeGuids: 1 } });
    const meta = data?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    return (meta.Guid ?? []).map((g: { id: string }) => g.id);
  }

  /**
   * Add one label to one item, preserving whatever it already carries.
   *
   * Two things this has to get right. Existing labels are read and resent.
   * That was written on the belief that Plex's tag PUT replaces the whole set;
   * a real server has since been seen to *add* (see `addLabelToAllItems`), so
   * the resend is now belt-and-braces rather than load-bearing. And
   * the write goes to the *section* endpoint with `type` and `id`, matching
   * `addLabelToAllItems` below: a PUT to `/library/metadata/:key` answers 200
   * for a library item and applies nothing, so the caller would believe it had
   * labelled something it hadn't. (Collections are the exception and do take
   * the metadata path — see `setCollectionLabels`.)
   */
  async function addItemLabel(ratingKey: string, sectionId: string, sectionType: string, label: string): Promise<void> {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);

    const data = await http.request(`/library/metadata/${ratingKey}`);
    const meta = data?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);

    const existing: string[] = (meta.Label ?? []).map((l: { tag: string }) => l.tag);
    if (existing.some((l) => l.toLowerCase() === label.toLowerCase())) return;

    const labelParams: Record<string, string | number> = {
      type: typeNum,
      id: ratingKey,
      "label.locked": 1,
    };
    const next = [...existing, label];
    for (let i = 0; i < next.length; i++) labelParams[`label[${i}].tag.tag`] = next[i];
    await http.request(`/library/sections/${sectionId}/all`, { method: "PUT", params: labelParams });
  }

  /**
   * Every label on every item in a section, keyed by rating key.
   *
   * A section listing carries no `Label` at all — checked against a real
   * server, where not one row of a 4,000-film listing had the key, including
   * films that were labelled. Anything reading `item.Label` off a listing
   * always saw "no labels". So this asks the other way round: the label
   * directory, then one filtered listing per label. A library has a few dozen
   * labels, most on nothing in a given section, so that is a few dozen cheap
   * requests rather than one per item.
   */
  async function itemLabelsBySection(sectionId: string): Promise<Map<string, string[]>> {
    const data = await http.request(`/library/sections/${sectionId}/label`);
    const directory: Array<{ key?: string | number; title?: string }> = data?.MediaContainer?.Directory ?? [];
    const byItem = new Map<string, string[]>();
    for (const entry of directory) {
      if (entry.key == null || !entry.title) continue;
      for await (const { item } of allItems(sectionId, { filters: { label: String(entry.key) } })) {
        if (!item.ratingKey) continue;
        const labels = byItem.get(item.ratingKey);
        if (labels) labels.push(entry.title);
        else byItem.set(item.ratingKey, [entry.title]);
      }
    }
    return byItem;
  }

  /**
   * Rating keys from a filtered walk, collected before anything is written.
   *
   * Collected first because the writes change the filter's answer: labelling
   * page one of a `label!=X` listing shrinks it, and the next page would then
   * start a hundred items too far in and skip them.
   */
  async function keysMatching(sectionId: string, filters: ListingFilters): Promise<string[]> {
    const keys: string[] = [];
    for await (const { item } of allItems(sectionId, { filters })) {
      if (item.ratingKey) keys.push(item.ratingKey);
    }
    return keys;
  }

  /**
   * One label PUT per batch of items, sequentially.
   *
   * Sequential because concurrency bought nothing: Plex serialises metadata
   * writes, and ten in flight ran at the same ~3 items/s as one. A failed batch
   * is logged and skipped rather than aborting the walk — every caller is
   * idempotent and a re-run picks the stragglers up through its filter.
   */
  async function writeLabelInBatches(
    sectionId: string,
    typeNum: number,
    keys: string[],
    params: Record<string, string | number>,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    let updated = 0;
    onProgress?.(0, keys.length);
    for (let i = 0; i < keys.length; i += LABEL_BATCH_SIZE) {
      const batch = keys.slice(i, i + LABEL_BATCH_SIZE);
      try {
        await http.request(`/library/sections/${sectionId}/all`, {
          method: "PUT",
          params: { type: typeNum, id: batch.join(","), ...params },
        });
        updated += batch.length;
      } catch (err) {
        console.warn(
          `[plex] Label write failed for ${batch.length} item(s) in section ${sectionId}:`,
          errorMessage(err),
        );
      }
      onProgress?.(Math.min(i + batch.length, keys.length), keys.length);
    }
    return updated;
  }

  /**
   * Put `label` on every item in a section that doesn't already carry it.
   *
   * Plex does the "doesn't already" part (`label!=`), so a re-run — the
   * personalization Reconcile button, or a resume after a failure — touches
   * only what is missing instead of the whole library again.
   *
   * Only the new label is sent. Plex's indexed tag PUT adds to what an item
   * has rather than replacing it (verified on a real server: films' existing
   * streaming-service labels survived), so there is nothing to read and merge.
   */
  async function addLabelToAllItems(
    sectionId: string,
    sectionType: string,
    label: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);
    const keys = await keysMatching(sectionId, { "label!": label });
    return writeLabelInBatches(sectionId, typeNum, keys, { "label.locked": 1, "label[0].tag.tag": label }, onProgress);
  }

  /**
   * Take `label` off every item in a section that carries it.
   *
   * Uses Plex's explicit removal form, `label[].tag.tag-=`, rather than
   * re-sending the list without it: since the indexed form *adds*, a list
   * that merely omits a label cannot be relied on to remove it.
   */
  async function removeLabelFromAllItems(
    sectionId: string,
    sectionType: string,
    label: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);
    const keys = await keysMatching(sectionId, { label });
    return writeLabelInBatches(sectionId, typeNum, keys, { "label.locked": 1, "label[].tag.tag-": label }, onProgress);
  }

  /**
   * The values a tag field can take in one library — `genre`, `studio`,
   * `director` — as `{ key, title }` pairs.
   *
   * The type qualifier is stripped. A smart filter names fields the way Plex's
   * *filter* syntax does, where `show.studio` means "the studio field of the
   * show type"; the *facet* endpoint underneath takes the bare field name and
   * answers `404` to the qualified one. Before this, every `show.`- or
   * `episode.`-prefixed clause got an empty list back — so the tag picker in the
   * rule wizard offered no values for them, and both the registry importer and
   * the bundle importer reported every one of those clauses as an unresolvable
   * tag while leaving it (correctly) untouched.
   */
  async function getFilterFieldValues(sectionId: string, field: string): Promise<{ key: string; title: string }[]> {
    const facet = field.includes(".") ? field.slice(field.indexOf(".") + 1) : field;
    const data = await http.request(`/library/sections/${sectionId}/${facet}`);
    const dirs = data?.MediaContainer?.Directory || [];
    return dirs.map((d: Record<string, unknown>) => ({
      key: String(d.key ?? d.ratingKey ?? ""),
      title: String(d.title ?? ""),
    }));
  }

  async function getItems(
    sectionId: string,
    options: { offset?: number; size?: number; title?: string; type?: number } = {},
  ): Promise<{ items: PlexMediaItem[]; total: number }> {
    const { offset = 0, size = 50, title, type } = options;
    const data = await http.request(`/library/sections/${sectionId}/all`, {
      params: {
        "X-Plex-Container-Start": offset,
        "X-Plex-Container-Size": size,
        ...(title ? { title } : {}),
        ...(type ? { type } : {}),
      },
    });
    const total: number = data?.MediaContainer?.totalSize ?? 0;
    return {
      items: parseMetadataArray(data?.MediaContainer?.Metadata).map((item) => {
        const media = item.Media?.[0];
        return {
          ratingKey: item.ratingKey ?? "",
          title: item.title ?? "",
          year: item.year,
          thumb: item.thumb,
          type: item.type ?? "",
          addedAt: item.addedAt,
          videoResolution: media?.videoResolution,
          videoCodec: media?.videoCodec,
          audioCodec: media?.audioCodec,
          audioChannels: media?.audioChannels,
          container: media?.container,
        };
      }),
      total,
    };
  }

  async function getItemsFiltered(
    sectionId: string,
    filters: MediaFilters,
    options: { offset?: number; size?: number; title?: string; type?: number } = {},
  ): Promise<{ items: PlexMediaItem[]; total: number }> {
    const { offset = 0, size = 50, title, type } = options;
    const titleLower = title?.toLowerCase();
    const matched: PlexMediaItem[] = [];

    for await (const { item } of allItems(sectionId)) {
      if (type) {
        const itemType = item.type ? SECTION_TYPE_MAP[item.type] : undefined;
        if (itemType && itemType !== type) continue;
      }

      if (titleLower && !(item.title ?? "").toLowerCase().includes(titleLower)) continue;

      const media = item.Media?.[0];
      if (!media) continue;

      if (filters.videoResolution && media.videoResolution !== filters.videoResolution) continue;
      if (filters.videoCodec && media.videoCodec !== filters.videoCodec) continue;
      if (filters.audioCodec && media.audioCodec !== filters.audioCodec) continue;
      if (filters.audioChannels && media.audioChannels !== filters.audioChannels) continue;
      if (filters.container && media.container !== filters.container) continue;

      matched.push({
        ratingKey: item.ratingKey ?? "",
        title: item.title ?? "",
        year: item.year,
        thumb: item.thumb,
        type: item.type ?? "",
        addedAt: item.addedAt,
        videoResolution: media.videoResolution,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        audioChannels: media.audioChannels,
        container: media.container,
      });
    }

    return {
      items: matched.slice(offset, offset + size),
      total: matched.length,
    };
  }

  async function getItemDetail(ratingKey: string): Promise<PlexMediaDetail> {
    const data = await http.request(`/library/metadata/${ratingKey}`);
    const rawMeta = data?.MediaContainer?.Metadata?.[0];
    if (!rawMeta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    const meta = plexMetadataRawSchema.parse(rawMeta);

    const media: PlexMediaInfo[] = (meta.Media ?? []).map((m) => {
      const parts: PlexPartInfo[] = (m.Part ?? []).map((p) => {
        const streams: PlexStreamInfo[] = (p.Stream ?? []).map((s) => ({
          streamType: s.streamType ?? 0,
          codec: s.codec,
          displayTitle: s.displayTitle,
          bitrate: s.bitrate,
          width: s.width,
          height: s.height,
          frameRate: s.frameRate != null ? Number(s.frameRate) : undefined,
          profile: s.profile,
          level: s.level,
          bitDepth: s.bitDepth,
          chromaSubsampling: s.chromaSubsampling,
          colorPrimaries: s.colorPrimaries,
          colorRange: s.colorRange,
          colorSpace: s.colorSpace,
          scanType: s.scanType,
          channels: s.channels,
          audioChannelLayout: s.audioChannelLayout,
          samplingRate: s.samplingRate,
          language: s.language,
          languageCode: s.languageCode,
        }));
        return {
          key: p.key,
          file: p.file,
          size: p.size,
          container: p.container,
          duration: p.duration,
          streams,
        };
      });
      return {
        videoResolution: m.videoResolution,
        videoCodec: m.videoCodec,
        videoFrameRate: m.videoFrameRate,
        videoProfile: m.videoProfile,
        audioCodec: m.audioCodec,
        audioChannels: m.audioChannels,
        container: m.container,
        bitrate: m.bitrate,
        width: m.width,
        height: m.height,
        optimizedForStreaming:
          m.optimizedForStreaming === 1 ||
          m.optimizedForStreaming === true ||
          m.optimizedForStreaming === "1" ||
          m.optimizedForStreaming === "true",
        parts,
      };
    });

    return {
      ratingKey: meta.ratingKey ?? "",
      title: meta.title ?? "",
      year: meta.year,
      thumb: meta.thumb,
      type: meta.type ?? "",
      addedAt: meta.addedAt,
      summary: meta.summary || "",
      contentRating: meta.contentRating,
      duration: meta.duration,
      originallyAvailableAt: meta.originallyAvailableAt,
      studio: meta.studio,
      rating: meta.rating,
      audienceRating: meta.audienceRating,
      viewOffset: meta.viewOffset,
      viewCount: meta.viewCount,
      genres: (meta.Genre ?? []).map((g) => g.tag),
      directors: (meta.Director ?? []).map((d) => d.tag),
      collections: (meta.Collection ?? []).map((c) => ({ id: c.id, tag: c.tag })),
      // The agent ids Plex matched this item to. Carried so the detail page
      // can link out to IMDb/TMDb — the fastest way to check a bad match.
      guids: (meta.Guid ?? []).map((g) => g.id),
      media,
    };
  }

  async function getMetadataChildren(ratingKey: string): Promise<PlexChildItem[]> {
    const data = await http.request(`/library/metadata/${ratingKey}/children`);
    return parseMetadataArray(data?.MediaContainer?.Metadata).map((m) => {
      const media = m.Media?.[0];
      return {
        ratingKey: m.ratingKey ?? "",
        type: m.type ?? "",
        title: m.title ?? "",
        index: m.index,
        thumb: m.thumb,
        leafCount: m.leafCount,
        year: m.year,
        videoResolution: media?.videoResolution,
        videoCodec: media?.videoCodec,
        audioCodec: media?.audioCodec,
        audioChannels: media?.audioChannels,
        container: media?.container,
      };
    });
  }

  async function getItemFullDetail(ratingKey: string): Promise<PlexMediaFullDetail> {
    const data = await http.request(`/library/metadata/${ratingKey}`);
    const rawMeta = data?.MediaContainer?.Metadata?.[0];
    if (!rawMeta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    const meta = plexMetadataRawSchema.parse(rawMeta);

    const guids: string[] = (meta.Guid ?? []).map((g) => g.id);
    const media: PlexMediaFullDetail["media"] = (meta.Media ?? []).map((m) => {
      const parts = m.Part ?? [];
      const streams = parts[0]?.Stream ?? [];
      const videoStream = streams.find((s) => s.streamType === 1);
      return {
        videoResolution: m.videoResolution,
        videoCodec: m.videoCodec,
        audioCodec: parts[0]?.audioProfile ?? m.audioCodec,
        audioChannels: m.audioChannels,
        bitrate: m.bitrate,
        width: m.width,
        height: m.height,
        bitDepth: videoStream?.bitDepth,
        colorSpace: videoStream?.colorSpace,
        videoDisplayTitle: videoStream?.displayTitle,
      };
    });

    return {
      ratingKey: meta.ratingKey ?? "",
      title: meta.title ?? "",
      year: meta.year,
      thumb: meta.thumb,
      type: meta.type ?? "",
      contentRating: meta.contentRating,
      rating: meta.rating,
      audienceRating: meta.audienceRating,
      duration: meta.duration,
      studio: meta.studio,
      editionTitle: meta.editionTitle,
      status: meta.status,
      guids,
      media,
    };
  }

  async function getThumbsByRatingKeys(ratingKeys: string[]): Promise<Map<string, string>> {
    const thumbs = new Map<string, string>();
    if (ratingKeys.length === 0) return thumbs;
    // Plex supports comma-separated ratingKeys at /library/metadata/{ids} — one round-trip.
    // Chunk to avoid pathological URL lengths.
    const CHUNK = 100;
    for (let i = 0; i < ratingKeys.length; i += CHUNK) {
      const chunk = ratingKeys.slice(i, i + CHUNK);
      const data = await http.request(`/library/metadata/${chunk.join(",")}`);
      const metas = parseMetadataArray(data?.MediaContainer?.Metadata);
      for (const m of metas) {
        if (m.ratingKey && m.thumb) thumbs.set(m.ratingKey, m.thumb);
      }
    }
    return thumbs;
  }

  return {
    allItems,
    showSizes,
    fetchAllItems,
    fetchItemsSorted,
    fetchGroupedByField,
    fetchItemsByFilter,
    countItemsByFilter,
    allItemsWithGuids,
    getSectionItemCount,
    getItemGuids,
    addItemLabel,
    addLabelToAllItems,
    itemLabelsBySection,
    removeLabelFromAllItems,
    getFilterFieldValues,
    getItems,
    getItemsFiltered,
    getItemDetail,
    getMetadataChildren,
    getItemFullDetail,
    getThumbsByRatingKeys,
  };
}
