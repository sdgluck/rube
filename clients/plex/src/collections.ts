import type { PlexHttp } from "./http.ts";
import {
  SECTION_TYPE_MAP,
  type PlexItem,
  type PlexCollection,
  type PlexCollectionDetail,
  type PlexLabel,
} from "./types.ts";

export function createCollectionsModule(http: PlexHttp) {
  async function getCollections(sectionId: string): Promise<PlexCollection[]> {
    const data = await http.request(`/library/sections/${sectionId}/all`, {
      params: { type: 18 },
    });
    return data?.MediaContainer?.Metadata || [];
  }

  async function getCollectionLabels(ratingKey: string): Promise<PlexLabel[]> {
    const detail = await http.request(`/library/metadata/${ratingKey}`);
    return detail?.MediaContainer?.Metadata?.[0]?.Label || [];
  }

  async function deleteItem(ratingKey: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}`, { method: "DELETE" });
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

  async function getCollectionChildren(ratingKey: string): Promise<PlexItem[]> {
    // Smart collections don't serve items via /children — they use a dynamic
    // query path stored in the metadata's key field.
    const detail = await http.request(`/library/metadata/${ratingKey}`);
    const meta = detail?.MediaContainer?.Metadata?.[0];
    const isSmart = meta?.smart === "1" || meta?.smart === 1 || meta?.smart === true;

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
      type: 18,
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
