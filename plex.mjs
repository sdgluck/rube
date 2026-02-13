/**
 * Plex API client factory.
 *
 * Usage:
 *   import { createPlexClient, TINKERBELL_MARKER, SECTION_TYPE_MAP } from "./plex.mjs";
 *   const client = createPlexClient({ url, token, verbose });
 */

export const TINKERBELL_MARKER = "[tinkerbell]";
export const SECTION_TYPE_MAP = { movie: 1, show: 2, artist: 8, photo: 13 };

export function createPlexClient({ url, token, verbose = false }) {
  const log = (...a) => verbose && console.log("  ", ...a);

  // ─── Core ───────────────────────────────────────────────────────────────────

  async function request(
    path,
    { method = "GET", params = {}, headers = {} } = {},
  ) {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    log(`${method} ${reqUrl.pathname}${reqUrl.search.replace(token, "***")}`);

    const res = await fetch(reqUrl.toString(), {
      method,
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
      throw new Error(
        `Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`,
      );
    }

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function getSections() {
    const data = await request("/library/sections");
    return data.MediaContainer.Directory || [];
  }

  async function getIdentity() {
    const data = await request("/");
    return data.MediaContainer;
  }

  // ─── Shuffle operations ─────────────────────────────────────────────────────

  async function getManagedHubs(sectionId) {
    const data = await request(`/hubs/sections/${sectionId}/manage`);
    return (data && data.MediaContainer && data.MediaContainer.Hub) || [];
  }

  async function moveHub(sectionId, hubId, afterId) {
    await request(`/hubs/sections/${sectionId}/manage/${hubId}/move`, {
      method: "PUT",
      params: { after: afterId },
    });
  }

  // ─── Generate operations ────────────────────────────────────────────────────

  async function fetchAllItems(sectionId) {
    const items = [];
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

      for (const item of batch) {
        items.push({
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
        });
      }

      offset += batch.length;
      const total = data?.MediaContainer?.totalSize ?? 0;
      if (offset >= total) break;
    }

    return items;
  }

  async function deleteTinkerbellCollections(sectionId) {
    const data = await request(`/library/sections/${sectionId}/all`, {
      params: { type: 18 },
    });
    const collections = data?.MediaContainer?.Metadata || [];

    let deleted = 0;
    for (const col of collections) {
      let isTinkerbell = col.summary?.includes(TINKERBELL_MARKER);

      if (!isTinkerbell) {
        const detail = await request(`/library/metadata/${col.ratingKey}`);
        const labels = detail?.MediaContainer?.Metadata?.[0]?.Label || [];
        isTinkerbell = labels.some((l) => l.tag.toLowerCase() === "tinkerbell");
      }

      if (isTinkerbell) {
        log(`Deleting collection "${col.title}" (${col.ratingKey})`);
        await request(`/library/metadata/${col.ratingKey}`, {
          method: "DELETE",
        });
        deleted++;
      }
    }
    return deleted;
  }

  async function createCollection(
    sectionId,
    sectionType,
    machineId,
    name,
    ratingKeys,
  ) {
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
    if (!collectionKey)
      throw new Error(`Failed to create collection "${name}"`);

    // Label with "Tinkerbell"
    await request(`/library/sections/${sectionId}/all`, {
      method: "PUT",
      params: {
        type: 18,
        id: collectionKey,
        "label[0].tag.tag": "Tinkerbell",
        "label.locked": 1,
      },
    });

    return collectionKey;
  }

  async function pinToHomepage(sectionId, collectionKey) {
    await request(`/hubs/sections/${sectionId}/manage`, {
      method: "POST",
      params: { metadataItemId: collectionKey },
    });

    const hubIdentifier = `custom.collection.${sectionId}.${collectionKey}`;
    log(`Promoting hub ${hubIdentifier}`);

    await request(`/hubs/sections/${sectionId}/manage/${hubIdentifier}`, {
      method: "PUT",
      params: {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      },
    });
    return true;
  }

  // ─── Cleanup operations ─────────────────────────────────────────────────────

  async function getCollections(sectionId) {
    const data = await request(`/library/sections/${sectionId}/all`, {
      params: { type: 18 },
    });
    return data?.MediaContainer?.Metadata || [];
  }

  async function getCollectionLabels(ratingKey) {
    const detail = await request(`/library/metadata/${ratingKey}`);
    return detail?.MediaContainer?.Metadata?.[0]?.Label || [];
  }

  async function deleteItem(ratingKey) {
    await request(`/library/metadata/${ratingKey}`, { method: "DELETE" });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    log,
    request,
    getSections,
    getIdentity,
    getManagedHubs,
    moveHub,
    fetchAllItems,
    deleteTinkerbellCollections,
    createCollection,
    pinToHomepage,
    getCollections,
    getCollectionLabels,
    deleteItem,
  };
}
