import type { PlexHttp } from "./http.ts";
import { plexHubRawSchema, parseMetadataArray } from "./schemas.ts";
import type { PlexHub, PlexHomeHub, PlexHubItem, PinOptions } from "./types.ts";

const MANAGE_HUB_PREFIX = "custom.collection.";

function normalizeManageHubIdentifier(id: string): string {
  if (!id.startsWith(MANAGE_HUB_PREFIX)) return id;
  const segments = id.slice(MANAGE_HUB_PREFIX.length).split(".");
  if (segments.length <= 2) return id;
  return `${MANAGE_HUB_PREFIX}${segments[0]}.${segments[1]}`;
}

function parseHubArray(raw: unknown): PlexHomeHub[] {
  if (!Array.isArray(raw)) return [];
  const hubs: PlexHomeHub[] = [];
  for (const h of raw) {
    const parsed = plexHubRawSchema.safeParse(h);
    if (!parsed.success) {
      console.warn("[plex] dropping malformed hub:", parsed.error.message);
      continue;
    }
    const hub = parsed.data;
    const items = parseMetadataArray(hub.Metadata).map((m): PlexHubItem => {
      const labels = (m.Label || []).map((l) => l.tag);
      return {
        ratingKey: m.ratingKey ?? "",
        title: m.title ?? "",
        type: m.type ?? "",
        year: m.year,
        thumb: m.thumb,
        art: m.art,
        parentThumb: m.parentThumb,
        grandparentThumb: m.grandparentThumb,
        grandparentTitle: m.grandparentTitle,
        parentTitle: m.parentTitle,
        parentIndex: m.parentIndex,
        index: m.index,
        duration: m.duration,
        viewOffset: m.viewOffset,
        viewCount: m.viewCount,
        addedAt: m.addedAt,
        contentRating: m.contentRating,
        summary: m.summary,
        librarySectionID: m.librarySectionID,
        librarySectionTitle: m.librarySectionTitle,
        labels,
      };
    });
    hubs.push({
      hubKey: hub.hubKey ?? hub.key ?? "",
      hubIdentifier: hub.hubIdentifier ?? "",
      title: hub.title ?? "",
      type: hub.type ?? "",
      context: hub.context,
      items,
    });
  }
  return hubs;
}

export function createHubsModule(http: PlexHttp) {
  async function getManagedHubs(sectionId: string): Promise<PlexHub[]> {
    const data = await http.request(`/hubs/sections/${sectionId}/manage`);
    const hubs: Array<Record<string, unknown>> = (data && data.MediaContainer && data.MediaContainer.Hub) || [];
    return hubs.map((h) => ({
      identifier: h.identifier as string,
      title: h.title as string,
      promotedToOwnHome: h.promotedToOwnHome != null ? Number(h.promotedToOwnHome) : undefined,
      promotedToRecommendedHome: h.promotedToRecommendedHome != null ? Number(h.promotedToRecommendedHome) : undefined,
      promotedToSharedHome: h.promotedToSharedHome != null ? Number(h.promotedToSharedHome) : undefined,
    }));
  }

  async function moveHub(sectionId: string, hubId: string, afterId: string): Promise<void> {
    await http.request(`/hubs/sections/${sectionId}/manage/${hubId}/move`, {
      method: "PUT",
      params: { after: afterId },
    });
  }

  async function unpinFromHomepage(sectionId: string, hubIdentifier: string): Promise<void> {
    // Plex's `/hubs` (home) endpoint returns collection-hub identifiers shaped
    //   custom.collection.{sectionId}.{ratingKey}.{ratingKey}
    // but the manage endpoint only accepts the canonical 2-segment form
    //   custom.collection.{sectionId}.{ratingKey}
    // Normalize so callers can pass identifiers from either source.
    const normalized = normalizeManageHubIdentifier(hubIdentifier);
    await http.request(`/hubs/sections/${sectionId}/manage/${normalized}`, {
      method: "DELETE",
    });
  }

  async function pinToHomepage(
    sectionId: string,
    collectionKey: string,
    opts: PinOptions = {
      promotedToOwnHome: 0,
      promotedToRecommendedHome: 0,
      promotedToSharedHome: 0,
    },
  ): Promise<boolean> {
    await http.request(`/hubs/sections/${sectionId}/manage`, {
      method: "POST",
      params: { metadataItemId: collectionKey },
    });

    const hubIdentifier = `custom.collection.${sectionId}.${collectionKey}`;

    await http.request(`/hubs/sections/${sectionId}/manage/${hubIdentifier}`, {
      method: "PUT",
      params: { ...opts },
    });
    return true;
  }

  async function getHomeHubs(opts: { count?: number } = {}): Promise<PlexHomeHub[]> {
    const { count = 20 } = opts;
    const data = await http.request("/hubs", {
      params: {
        count,
        includeFields: "label,librarySectionID,librarySectionTitle,art,thumb",
        excludeFields: "summary",
        includeStations: 1,
      },
    });
    return parseHubArray(data?.MediaContainer?.Hub);
  }

  async function getRecentlyAddedForSection(sectionId: string, limit = 20): Promise<PlexHubItem[]> {
    const data = await http.request(`/library/sections/${sectionId}/recentlyAdded`, {
      params: {
        "X-Plex-Container-Size": limit,
        includeFields: "label",
      },
    });
    return parseMetadataArray(data?.MediaContainer?.Metadata).map((m) => ({
      ratingKey: m.ratingKey ?? "",
      title: m.title ?? "",
      type: m.type ?? "",
      year: m.year,
      thumb: m.thumb,
      art: m.art,
      parentThumb: m.parentThumb,
      grandparentThumb: m.grandparentThumb,
      grandparentTitle: m.grandparentTitle,
      parentTitle: m.parentTitle,
      addedAt: m.addedAt,
      contentRating: m.contentRating,
      librarySectionID: m.librarySectionID,
      librarySectionTitle: m.librarySectionTitle,
      labels: (m.Label || []).map((l) => l.tag),
    }));
  }

  return {
    getManagedHubs,
    moveHub,
    unpinFromHomepage,
    pinToHomepage,
    getHomeHubs,
    getRecentlyAddedForSection,
  };
}
