/**
 * Plex API client factory.
 *
 * Usage:
 *   import { createPlexClient, SECTION_TYPE_MAP } from "./plex.ts";
 *   const client = createPlexClient({ url, token });
 */

import PQueue from "p-queue";

export const SECTION_TYPE_MAP: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };

interface PlexClientOptions {
  url: string;
  token: string;
  signal?: AbortSignal;
}

interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | undefined | null>;
  headers?: Record<string, string>;
}

export interface PlexSection {
  key: string;
  title: string;
  type: string;
}

export interface PlexHub {
  identifier: string;
  title: string;
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
}

export interface PlexHistoryItem {
  type: string;
  ratingKey: string;
  title: string;
  year?: number;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
  accountID?: number;
  viewedAt?: number;
}

export interface PlexCollection {
  ratingKey: string;
  title: string;
  addedAt?: number;
}

export interface PlexCollectionDetail {
  ratingKey: string;
  title: string;
  summary: string;
  childCount: number;
  thumb: string;
  labels: string[];
  smart: boolean;
  addedAt?: number;
}

export interface PlexLabel {
  tag: string;
}

export interface PlexAccount {
  id: string;
  name?: string;
}

export interface PlexSharing {
  id: number;
  userId: number;
  username: string;
  machineIdentifier: string;
}

export interface PlexSession {
  title: string;
  type: string;
  year?: number;
  thumb?: string;
  grandparentTitle?: string;
  user: string;
  player: string;
  state: string;
  decision: string;
}

export interface PlexRecentItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt: number;
}

interface PinOptions {
  promotedToOwnHome?: number;
  promotedToRecommendedHome?: number;
  promotedToSharedHome?: number;
}

interface WatchHistoryOptions {
  accountID?: string;
  librarySectionID?: string;
  limit?: number;
}

export function createPlexClient({ url, token, signal }: PlexClientOptions) {
  // ─── Core ───────────────────────────────────────────────────────────────────

  async function request(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    const res = await fetch(reqUrl.toString(), {
      method,
      signal,
      headers: {
        Accept: "application/json",
        "X-Plex-Client-Identifier": "tinkerbell",
        "X-Plex-Product": "tinkerbell",
        "X-Plex-Version": "1.0.0",
        ...headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
    }

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function getSections(): Promise<PlexSection[]> {
    const data = await request("/library/sections");
    return data.MediaContainer.Directory || [];
  }

  async function getIdentity(): Promise<{ friendlyName: string; machineIdentifier: string }> {
    const data = await request("/");
    return data.MediaContainer;
  }

  // ─── Shuffle operations ─────────────────────────────────────────────────────

  async function getManagedHubs(sectionId: string): Promise<PlexHub[]> {
    const data = await request(`/hubs/sections/${sectionId}/manage`);
    return (data && data.MediaContainer && data.MediaContainer.Hub) || [];
  }

  async function moveHub(sectionId: string, hubId: string, afterId: string): Promise<void> {
    await request(`/hubs/sections/${sectionId}/manage/${hubId}/move`, {
      method: "PUT",
      params: { after: afterId },
    });
  }

  // ─── Generate operations ────────────────────────────────────────────────────

  async function fetchAllItems(sectionId: string): Promise<PlexItem[]> {
    const items: PlexItem[] = [];
    for await (const { item } of allItems(sectionId)) {
      items.push({
        ratingKey: item.ratingKey as string,
        title: item.title as string,
        year: item.year as number | undefined,
      });
    }
    return items;
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
    await request(`/hubs/sections/${sectionId}/manage`, {
      method: "POST",
      params: { metadataItemId: collectionKey },
    });

    const hubIdentifier = `custom.collection.${sectionId}.${collectionKey}`;

    await request(`/hubs/sections/${sectionId}/manage/${hubIdentifier}`, {
      method: "PUT",
      params: opts as unknown as Record<string, number>,
    });
    return true;
  }

  // ─── Plex.tv API ──────────────────────────────────────────────────────────

  async function plexTvRequest(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = new URL(path, "https://plex.tv");
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    const res = await fetch(reqUrl.toString(), {
      method,
      signal,
      headers: {
        Accept: "application/json",
        "X-Plex-Client-Identifier": "tinkerbell",
        "X-Plex-Product": "tinkerbell",
        "X-Plex-Version": "1.0.0",
        ...headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Plex.tv API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
    }

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }

  async function getSharings(machineIdentifier: string): Promise<PlexSharing[]> {
    const results: PlexSharing[] = [];
    const seenIds = new Set<number>();

    // Friends (shared users) — /api/users/ returns XML, not JSON
    try {
      const data = await plexTvRequest("/api/users/");
      const xml: string = data?._raw || "";
      if (xml) {
        const userRegex = /<User\s([^>]+)>([\s\S]*?)<\/User>/g;
        let match;
        while ((match = userRegex.exec(xml)) !== null) {
          const attrs = match[1];
          const children = match[2];
          const userId = attrs.match(/\bid="(\d+)"/)?.[1];
          const username = attrs.match(/\busername="([^"]*)"/)?.[1];
          const title = attrs.match(/\btitle="([^"]*)"/)?.[1];

          const serverRegex = /<Server\s([^>]*machineIdentifier="[^"]*"[^>]*)\/?>|<Server\s([^>]*)>[^<]*<\/Server>/g;
          let serverMatch;
          while ((serverMatch = serverRegex.exec(children)) !== null) {
            const serverAttrs = serverMatch[1] || serverMatch[2];
            if (serverAttrs.includes(`machineIdentifier="${machineIdentifier}"`)) {
              if (userId) {
                const id = parseInt(userId, 10);
                seenIds.add(id);
                results.push({
                  id,
                  userId: id,
                  username: username || title || "",
                  machineIdentifier,
                });
              }
              break;
            }
          }
        }
      }
    } catch {
      // Failed to fetch friends
    }

    // Home/managed users
    try {
      const data = await plexTvRequest("/api/v2/home/users");
      const homeUsers = data?.users || (Array.isArray(data) ? data : []);
      for (const user of homeUsers) {
        if (String(user.admin) === "1" || user.admin === true) continue;
        if (String(user.guest) === "1" || user.guest === true) continue;
        if (seenIds.has(user.id)) continue;
        results.push({
          id: user.id,
          userId: user.id,
          username: user.username || user.title || user.friendlyName || "",
          machineIdentifier,
        });
      }
    } catch {
      // Failed to fetch home users
    }

    return results;
  }

  async function setSharingRestrictions(userId: number, labels: string[]): Promise<void> {
    const filterStr = `label=${labels.join("|")}`;

    await plexTvRequest(`/api/friends/${userId}`, {
      method: "PUT",
      params: {
        filterMovies: filterStr,
        filterTelevision: filterStr,
      },
    });
  }

  async function clearSharingRestrictions(userId: number): Promise<void> {
    await plexTvRequest(`/api/friends/${userId}`, {
      method: "PUT",
      params: {
        filterMovies: "",
        filterTelevision: "",
      },
    });
  }

  // ─── Watch history & accounts ──────────────────────────────────────────────

  async function getWatchHistory({ accountID, librarySectionID, limit = 50 }: WatchHistoryOptions = {}): Promise<
    PlexHistoryItem[]
  > {
    const params: Record<string, string | number> = {
      sort: "viewedAt:desc",
      "X-Plex-Container-Size": limit,
    };
    if (accountID) params.accountID = accountID;
    if (librarySectionID) params.librarySectionID = librarySectionID;

    const data = await request("/status/sessions/history/all", { params });
    return (data?.MediaContainer?.Metadata || []).map((item: Record<string, unknown>) => ({
      type: item.type as string,
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
      grandparentTitle: item.grandparentTitle as string | undefined,
      grandparentRatingKey: item.grandparentRatingKey as string | undefined,
      accountID: item.accountID as number | undefined,
      viewedAt: item.viewedAt as number | undefined,
    }));
  }

  async function getAccounts(): Promise<PlexAccount[]> {
    const data = await request("/accounts");
    return data?.MediaContainer?.Account || [];
  }

  // ─── Label-based collection management ────────────────────────────────────

  async function deleteCollectionsByLabel(sectionId: string, label: string): Promise<number> {
    const collections = await getCollections(sectionId);
    let deleted = 0;
    for (const col of collections) {
      const labels = await getCollectionLabels(col.ratingKey);
      if (labels.some((l: PlexLabel) => l.tag.toLowerCase() === label.toLowerCase())) {
        await deleteItem(col.ratingKey);
        deleted++;
      }
    }
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

    const data = await request("/library/collections", {
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
      type: 18,
      id: collectionKey,
      "label.locked": 1,
    };
    for (let i = 0; i < labelArray.length; i++) {
      labelParams[`label[${i}].tag.tag`] = labelArray[i];
    }

    await request(`/library/sections/${sectionId}/all`, {
      method: "PUT",
      params: labelParams,
    });

    return collectionKey;
  }

  // ─── Cleanup operations ─────────────────────────────────────────────────────

  async function getCollections(sectionId: string): Promise<PlexCollection[]> {
    const data = await request(`/library/sections/${sectionId}/all`, {
      params: { type: 18 },
    });
    return data?.MediaContainer?.Metadata || [];
  }

  async function getCollectionLabels(ratingKey: string): Promise<PlexLabel[]> {
    const detail = await request(`/library/metadata/${ratingKey}`);
    return detail?.MediaContainer?.Metadata?.[0]?.Label || [];
  }

  async function deleteItem(ratingKey: string): Promise<void> {
    await request(`/library/metadata/${ratingKey}`, { method: "DELETE" });
  }

  // ─── Collection detail operations ──────────────────────────────────────────

  async function getCollectionDetail(ratingKey: string): Promise<PlexCollectionDetail> {
    const detail = await request(`/library/metadata/${ratingKey}`);
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
      addedAt: meta.addedAt,
    };
  }

  async function getCollectionChildren(ratingKey: string): Promise<PlexItem[]> {
    // Check if this is a smart collection — smart collections don't serve items
    // via /children, they use a dynamic query path stored in the metadata's key field.
    const detail = await request(`/library/metadata/${ratingKey}`);
    const meta = detail?.MediaContainer?.Metadata?.[0];
    const isSmart = meta?.smart === "1" || meta?.smart === 1 || meta?.smart === true;

    let metadata;
    if (isSmart && meta?.key) {
      const data = await request(meta.key);
      metadata = data?.MediaContainer?.Metadata || [];
    } else {
      const data = await request(`/library/metadata/${ratingKey}/children`);
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
    await request(`/library/metadata/${ratingKey}`, { method: "PUT", params });
  }

  // ─── Iterate all items in a section ─────────────────────────────────────────

  async function* allItems(sectionId: string): AsyncGenerator<{ item: Record<string, unknown>; totalSize: number }> {
    const pageSize = 100;
    let offset = 0;

    while (true) {
      const data = await request(`/library/sections/${sectionId}/all`, {
        params: {
          "X-Plex-Container-Start": offset,
          "X-Plex-Container-Size": pageSize,
        },
      });

      const batch = data?.MediaContainer?.Metadata || [];
      if (batch.length === 0) break;

      const totalSize: number = data?.MediaContainer?.totalSize ?? 0;

      for (const item of batch) {
        yield { item, totalSize };
      }

      offset += batch.length;
      if (offset >= totalSize) break;
    }
  }

  // ─── Add label to all items in a section ───────────────────────────────────

  async function addLabelToAllItems(
    sectionId: string,
    sectionType: string,
    label: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);

    const queue = new PQueue({ concurrency: 10 });
    let updated = 0;
    let processed = 0;

    for await (const { item, totalSize } of allItems(sectionId)) {
      const existingLabels: string[] = ((item.Label as PlexLabel[]) || []).map((l) => l.tag);

      if (existingLabels.some((l) => l.toLowerCase() === label.toLowerCase())) {
        processed++;
        if (onProgress) onProgress(processed, totalSize);
        continue;
      }

      const newLabels = [...existingLabels, label];
      const labelParams: Record<string, string | number> = {
        type: typeNum,
        id: item.ratingKey as string,
        "label.locked": 1,
      };
      for (let i = 0; i < newLabels.length; i++) {
        labelParams[`label[${i}].tag.tag`] = newLabels[i];
      }

      void queue.add(async () => {
        await request(`/library/sections/${sectionId}/all`, { method: "PUT", params: labelParams });
        updated++;
        processed++;
        if (onProgress) onProgress(processed, totalSize);
      });
    }

    await queue.onIdle();

    return updated;
  }

  // ─── Remove label from all items in a section ──────────────────────────────

  async function removeLabelFromAllItems(
    sectionId: string,
    sectionType: string,
    label: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const typeNum = SECTION_TYPE_MAP[sectionType];
    if (!typeNum) throw new Error(`Unknown section type: ${sectionType}`);

    const queue = new PQueue({ concurrency: 10 });
    let updated = 0;
    let processed = 0;

    for await (const { item, totalSize } of allItems(sectionId)) {
      void queue.add(async () => {
        // Bulk listing may not include Label data — fetch individual metadata
        const detail = await request(`/library/metadata/${item.ratingKey}`);
        const meta = detail?.MediaContainer?.Metadata?.[0];
        const existingLabels: string[] = (meta?.Label || []).map((l: PlexLabel) => l.tag);

        if (!existingLabels.some((l) => l.toLowerCase() === label.toLowerCase())) {
          processed++;
          if (onProgress) onProgress(processed, totalSize);
          return;
        }

        const newLabels = existingLabels.filter((l) => l.toLowerCase() !== label.toLowerCase());
        const labelParams: Record<string, string | number> = {
          type: typeNum,
          id: item.ratingKey as string,
          "label.locked": 1,
        };
        for (let i = 0; i < newLabels.length; i++) {
          labelParams[`label[${i}].tag.tag`] = newLabels[i];
        }

        await request(`/library/sections/${sectionId}/all`, { method: "PUT", params: labelParams });
        updated++;
        processed++;
        if (onProgress) onProgress(processed, totalSize);
      });
    }

    await queue.onIdle();

    return updated;
  }

  // ─── Set labels on a collection ────────────────────────────────────────────

  async function setCollectionLabels(sectionId: string, ratingKey: string, labels: string[]): Promise<void> {
    const labelParams: Record<string, string | number> = {
      "label.locked": 1,
    };
    for (let i = 0; i < labels.length; i++) {
      labelParams[`label[${i}].tag.tag`] = labels[i];
    }
    await request(`/library/metadata/${ratingKey}`, { method: "PUT", params: labelParams });
  }

  // ─── Smart collection operations ───────────────────────────────────────────

  async function getSmartCollectionContent(ratingKey: string): Promise<{ content: string; key: string }> {
    const detail = await request(`/library/metadata/${ratingKey}`);
    const meta = detail?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error(`No metadata found for ratingKey ${ratingKey}`);
    return { content: meta.content || "", key: meta.key || "" };
  }

  async function updateSmartCollectionContent(ratingKey: string, contentUri: string): Promise<void> {
    await request(`/library/collections/${ratingKey}/items`, {
      method: "PUT",
      params: { uri: contentUri },
    });
  }

  // ─── Sessions & recently added ─────────────────────────────────────────────

  async function getActiveSessions(): Promise<PlexSession[]> {
    const data = await request("/status/sessions");
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((item: Record<string, unknown>) => ({
      title: item.title as string,
      type: item.type as string,
      year: item.year as number | undefined,
      thumb: item.thumb as string | undefined,
      grandparentTitle: item.grandparentTitle as string | undefined,
      user: ((item.User as Record<string, unknown>)?.title as string) || "Unknown",
      player: ((item.Player as Record<string, unknown>)?.title as string) || "Unknown",
      state: ((item.Player as Record<string, unknown>)?.state as string) || "playing",
      decision:
        (((item.Media as Array<Record<string, unknown>>)?.[0]?.Part as Array<Record<string, unknown>>)?.[0]
          ?.decision as string) || "directplay",
    }));
  }

  async function getRecentlyAdded(limit = 20): Promise<PlexRecentItem[]> {
    const data = await request("/library/recentlyAdded", {
      params: { "X-Plex-Container-Size": limit },
    });
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((item: Record<string, unknown>) => ({
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
      thumb: item.thumb as string | undefined,
      type: item.type as string,
      addedAt: item.addedAt as number,
    }));
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    getSections,
    getIdentity,
    getManagedHubs,
    moveHub,
    fetchAllItems,
    pinToHomepage,
    getCollections,
    getCollectionLabels,
    getCollectionDetail,
    getCollectionChildren,
    updateCollection,
    deleteItem,
    getWatchHistory,
    getAccounts,
    deleteCollectionsByLabel,
    createCollectionWithLabel,
    getSharings,
    setSharingRestrictions,
    clearSharingRestrictions,
    setCollectionLabels,
    addLabelToAllItems,
    removeLabelFromAllItems,
    getSmartCollectionContent,
    updateSmartCollectionContent,
    getActiveSessions,
    getRecentlyAdded,
  };
}

export type PlexClient = ReturnType<typeof createPlexClient>;
