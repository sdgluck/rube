/**
 * Plex API client factory.
 *
 * Usage:
 *   import { createPlexClient, SECTION_TYPE_MAP } from "./plex.ts";
 *   const client = createPlexClient({ url, token });
 */

import PQueue from "p-queue";
import { z } from "zod";
import { reportHealth } from "./health.ts";
import { errorMessage } from "./util.ts";

export const SECTION_TYPE_MAP: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };

// ─── Plex API response schemas ─────────────────────────────────────────────
// Permissive: passthrough preserves unknown fields (Plex adds them silently),
// safeParse drops malformed items with a warning rather than throwing.

const plexStreamRawSchema = z
  .object({
    streamType: z.number().optional(),
    codec: z.string().optional(),
    displayTitle: z.string().optional(),
    bitrate: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    frameRate: z.union([z.number(), z.string()]).optional(),
    profile: z.string().optional(),
    level: z.number().optional(),
    bitDepth: z.number().optional(),
    chromaSubsampling: z.string().optional(),
    colorPrimaries: z.string().optional(),
    colorRange: z.string().optional(),
    colorSpace: z.string().optional(),
    scanType: z.string().optional(),
    channels: z.number().optional(),
    audioChannelLayout: z.string().optional(),
    samplingRate: z.number().optional(),
    language: z.string().optional(),
    languageCode: z.string().optional(),
  })
  .passthrough();

const plexPartRawSchema = z
  .object({
    file: z.string().optional(),
    size: z.number().optional(),
    container: z.string().optional(),
    duration: z.number().optional(),
    decision: z.string().optional(),
    audioProfile: z.string().optional(),
    Stream: z.array(plexStreamRawSchema).optional(),
  })
  .passthrough();

const plexMediaRawSchema = z
  .object({
    videoResolution: z.string().optional(),
    videoCodec: z.string().optional(),
    videoFrameRate: z.string().optional(),
    videoProfile: z.string().optional(),
    audioCodec: z.string().optional(),
    audioChannels: z.number().optional(),
    container: z.string().optional(),
    bitrate: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    optimizedForStreaming: z.union([z.boolean(), z.number(), z.string()]).optional(),
    Part: z.array(plexPartRawSchema).optional(),
  })
  .passthrough();

const plexPlayerRawSchema = z
  .object({
    title: z.string().optional(),
    machineIdentifier: z.string().optional(),
    product: z.string().optional(),
    platform: z.string().optional(),
    state: z.string().optional(),
    local: z.union([z.boolean(), z.number(), z.string()]).optional(),
    relayed: z.union([z.boolean(), z.number(), z.string()]).optional(),
    secure: z.union([z.boolean(), z.number(), z.string()]).optional(),
    address: z.string().optional(),
  })
  .passthrough();

const plexUserRawSchema = z
  .object({
    title: z.string().optional(),
    thumb: z.string().optional(),
  })
  .passthrough();

const plexSessionRawSchema = z
  .object({
    location: z.string().optional(),
    bandwidth: z.number().optional(),
  })
  .passthrough();

const plexTranscodeSessionRawSchema = z
  .object({
    videoDecision: z.string().optional(),
    audioDecision: z.string().optional(),
    speed: z.number().optional(),
    progress: z.number().optional(),
    transcodeHwEncoding: z.union([z.boolean(), z.number(), z.string()]).optional(),
    sourceVideoCodec: z.string().optional(),
    sourceAudioCodec: z.string().optional(),
  })
  .passthrough();

const plexLabelRawSchema = z.object({ tag: z.string() }).passthrough();
const plexGuidRawSchema = z.object({ id: z.string() }).passthrough();
const plexGenreRawSchema = z.object({ tag: z.string() }).passthrough();
const plexCollectionRefRawSchema = z.object({ id: z.number(), tag: z.string() }).passthrough();

const plexMetadataRawSchema = z
  .object({
    ratingKey: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    year: z.number().optional(),
    thumb: z.string().optional(),
    parentThumb: z.string().optional(),
    grandparentTitle: z.string().optional(),
    grandparentRatingKey: z.string().optional(),
    parentTitle: z.string().optional(),
    parentIndex: z.number().optional(),
    index: z.number().optional(),
    addedAt: z.number().optional(),
    summary: z.string().optional(),
    contentRating: z.string().optional(),
    duration: z.number().optional(),
    originallyAvailableAt: z.string().optional(),
    studio: z.string().optional(),
    editionTitle: z.string().optional(),
    rating: z.number().optional(),
    audienceRating: z.number().optional(),
    viewOffset: z.number().optional(),
    viewCount: z.number().optional(),
    viewedAt: z.number().optional(),
    accountID: z.number().optional(),
    leafCount: z.number().optional(),
    Media: z.array(plexMediaRawSchema).optional(),
    Player: plexPlayerRawSchema.optional(),
    User: plexUserRawSchema.optional(),
    Session: plexSessionRawSchema.optional(),
    TranscodeSession: plexTranscodeSessionRawSchema.optional(),
    Label: z.array(plexLabelRawSchema).optional(),
    Guid: z.array(plexGuidRawSchema).optional(),
    Genre: z.array(plexGenreRawSchema).optional(),
    Director: z.array(plexGenreRawSchema).optional(),
    Collection: z.array(plexCollectionRefRawSchema).optional(),
  })
  .passthrough();

type PlexMetadataRaw = z.infer<typeof plexMetadataRawSchema>;

function parseMetadataArray(raw: unknown): PlexMetadataRaw[] {
  if (!Array.isArray(raw)) return [];
  const out: PlexMetadataRaw[] = [];
  for (const item of raw) {
    const parsed = plexMetadataRawSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else console.warn("[plex] dropping malformed metadata item:", parsed.error.message);
  }
  return out;
}

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
  promotedToOwnHome?: number;
  promotedToRecommendedHome?: number;
  promotedToSharedHome?: number;
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
  parentThumb?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  user: string;
  userThumb?: string;
  player: string;
  playerMachineId?: string;
  product?: string;
  platform?: string;
  state: string;
  local?: boolean;
  relayed?: boolean;
  secure?: boolean;
  address?: string;
  location?: string;
  bandwidth?: number;
  decision: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  videoDecision?: string;
  audioDecision?: string;
  transcodeSpeed?: number;
  transcodeProgress?: number;
  transcodeHwEncoding?: boolean;
  sourceVideoCodec?: string;
  sourceAudioCodec?: string;
}

export interface PlexRecentItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt: number;
}

export interface PlexMediaItem {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface PlexStreamInfo {
  streamType: number; // 1=video, 2=audio, 3=subtitle
  codec?: string;
  displayTitle?: string;
  bitrate?: number;
  // Video
  width?: number;
  height?: number;
  frameRate?: number;
  profile?: string;
  level?: number;
  bitDepth?: number;
  chromaSubsampling?: string;
  colorPrimaries?: string;
  colorRange?: string;
  colorSpace?: string;
  scanType?: string;
  // Audio
  channels?: number;
  audioChannelLayout?: string;
  samplingRate?: number;
  language?: string;
  languageCode?: string;
}

export interface PlexPartInfo {
  file?: string;
  size?: number;
  container?: string;
  duration?: number;
  streams: PlexStreamInfo[];
}

export interface PlexMediaInfo {
  videoResolution?: string;
  videoCodec?: string;
  videoFrameRate?: string;
  videoProfile?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  optimizedForStreaming?: boolean;
  parts: PlexPartInfo[];
}

export interface PlexMediaDetail extends PlexMediaItem {
  summary: string;
  contentRating?: string;
  duration?: number;
  originallyAvailableAt?: string;
  studio?: string;
  rating?: number;
  audienceRating?: number;
  viewOffset?: number;
  viewCount?: number;
  genres: string[];
  directors: string[];
  collections: Array<{ id: number; tag: string }>;
  media: PlexMediaInfo[];
}

export interface PlexDirectoryEntry {
  tag: string;
  count: number;
  key: string;
}

export interface PlexMediaFullDetail {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  contentRating?: string;
  rating?: number;
  audienceRating?: number;
  duration?: number;
  studio?: string;
  editionTitle?: string;
  guids: string[];
  media: Array<{
    videoResolution?: string;
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    bitrate?: number;
    width?: number;
    height?: number;
    bitDepth?: number;
    colorSpace?: string;
    videoDisplayTitle?: string;
  }>;
}

export interface PlexPoster {
  key: string;
  selected: boolean;
  ratingKey: string;
}

export interface PlexChildItem {
  ratingKey: string;
  type: string;
  title: string;
  index?: number;
  thumb?: string;
  leafCount?: number;
  year?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}

export interface MediaFilters {
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
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

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;

function retryDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlexClient({ url, token, signal }: PlexClientOptions) {
  // ─── Core ───────────────────────────────────────────────────────────────────

  async function request(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(reqUrl.toString(), {
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
      } catch (err) {
        // Network errors: retry if we have attempts left
        if (attempt < MAX_RETRIES) {
          console.warn(`[plex] ${method} ${path} network error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await sleep(retryDelay(attempt));
          continue;
        }
        reportHealth("Plex", "error", `${method} ${path} → ${errorMessage(err)}`);
        throw err;
      }

      if (!res.ok) {
        if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < MAX_RETRIES) {
          console.warn(`[plex] ${method} ${path} → ${res.status}, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await sleep(retryDelay(attempt));
          continue;
        }
        const body = await res.text().catch(() => "");
        reportHealth("Plex", "error", `${method} ${path} → ${res.status} ${res.statusText}`);
        throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
      }

      reportHealth("Plex", "ok", `${method} ${path} → ${res.status}`);

      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
  }

  async function requestRaw(
    path: string,
    { method = "GET", params = {}, headers = {} }: RequestOptions = {},
  ): Promise<Response> {
    const reqUrl = new URL(path, url);
    reqUrl.searchParams.set("X-Plex-Token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    const res = await fetch(reqUrl.toString(), {
      method,
      signal,
      headers: {
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

    return res;
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
    await request(`/hubs/sections/${sectionId}/manage/${hubId}/move`, {
      method: "PUT",
      params: { after: afterId },
    });
  }

  async function unpinFromHomepage(sectionId: string, hubIdentifier: string): Promise<void> {
    await request(`/hubs/sections/${sectionId}/manage/${hubIdentifier}`, {
      method: "DELETE",
    });
  }

  // ─── Generate operations ────────────────────────────────────────────────────

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
    const data = await request(`/library/sections/${sectionId}/all`, {
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
    const data = await request(`/library/sections/${sectionId}/${field}`);
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
    const data = await request(filterPath);
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((item: Record<string, unknown>) => ({
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
    }));
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
      params: { ...opts },
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

    let res: Response;
    try {
      res = await fetch(reqUrl.toString(), {
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
    } catch (err) {
      reportHealth("Plex.tv", "error", `${method} ${path} → ${errorMessage(err)}`);
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      reportHealth("Plex.tv", "error", `${method} ${path} → ${res.status} ${res.statusText}`);
      throw new Error(`Plex.tv API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
    }

    reportHealth("Plex.tv", "ok", `${method} ${path} → ${res.status}`);

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

  async function* allItems(
    sectionId: string,
    opts?: { includeGuids?: boolean },
  ): AsyncGenerator<{ item: PlexMetadataRaw; totalSize: number }> {
    const pageSize = 100;
    let offset = 0;

    while (true) {
      const data = await request(`/library/sections/${sectionId}/all`, {
        params: {
          "X-Plex-Container-Start": offset,
          "X-Plex-Container-Size": pageSize,
          ...(opts?.includeGuids ? { includeGuids: 1 } : {}),
        },
      });

      const batch = parseMetadataArray(data?.MediaContainer?.Metadata);
      const rawLen = Array.isArray(data?.MediaContainer?.Metadata) ? data.MediaContainer.Metadata.length : 0;
      if (rawLen === 0) break;

      const totalSize: number = data?.MediaContainer?.totalSize ?? 0;

      for (const item of batch) {
        yield { item, totalSize };
      }

      offset += rawLen;
      if (offset >= totalSize) break;
    }
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
      const existingLabels: string[] = (item.Label ?? []).map((l) => l.tag);

      if (existingLabels.some((l) => l.toLowerCase() === label.toLowerCase())) {
        processed++;
        if (onProgress) onProgress(processed, totalSize);
        continue;
      }

      const newLabels = [...existingLabels, label];
      const labelParams: Record<string, string | number> = {
        type: typeNum,
        id: item.ratingKey ?? "",
        "label.locked": 1,
      };
      for (let i = 0; i < newLabels.length; i++) {
        labelParams[`label[${i}].tag.tag`] = newLabels[i];
      }

      void queue.add(async () => {
        try {
          await request(`/library/sections/${sectionId}/all`, { method: "PUT", params: labelParams });
          updated++;
        } catch (err) {
          console.warn(`[plex] Failed to add label to item ${item.ratingKey}:`, errorMessage(err));
        }
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
        try {
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
            id: item.ratingKey ?? "",
            "label.locked": 1,
          };
          for (let i = 0; i < newLabels.length; i++) {
            labelParams[`label[${i}].tag.tag`] = newLabels[i];
          }

          await request(`/library/sections/${sectionId}/all`, { method: "PUT", params: labelParams });
          updated++;
        } catch (err) {
          console.warn(`[plex] Failed to remove label from item ${item.ratingKey}:`, errorMessage(err));
        }
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

  async function getFilterFieldValues(sectionId: string, field: string): Promise<{ key: string; title: string }[]> {
    const data = await request(`/library/sections/${sectionId}/${field}`);
    const dirs = data?.MediaContainer?.Directory || [];
    return dirs.map((d: Record<string, unknown>) => ({
      key: String(d.key ?? d.ratingKey ?? ""),
      title: String(d.title ?? ""),
    }));
  }

  // ─── Sessions & recently added ─────────────────────────────────────────────

  async function getActiveSessions(): Promise<PlexSession[]> {
    const data = await request("/status/sessions");
    const items = parseMetadataArray(data?.MediaContainer?.Metadata);
    return items.map((item) => {
      const player = item.Player;
      const user = item.User;
      const session = item.Session;
      const media = item.Media?.[0];
      const part = media?.Part?.[0];
      const transcode = item.TranscodeSession;
      const toBool = (v: boolean | number | string | undefined) =>
        v === undefined ? undefined : v === true || v === 1 || v === "1" || v === "true";

      return {
        title: item.title ?? "",
        type: item.type ?? "",
        year: item.year,
        thumb: item.thumb,
        parentThumb: item.parentThumb,
        grandparentTitle: item.grandparentTitle,
        parentTitle: item.parentTitle,
        parentIndex: item.parentIndex,
        index: item.index,
        duration: item.duration ?? media?.duration,
        viewOffset: item.viewOffset,
        user: user?.title || "Unknown",
        userThumb: user?.thumb,
        player: player?.title || "Unknown",
        playerMachineId: player?.machineIdentifier,
        product: player?.product,
        platform: player?.platform,
        state: player?.state || "playing",
        local: toBool(player?.local),
        relayed: toBool(player?.relayed),
        secure: toBool(player?.secure),
        address: player?.address,
        location: session?.location,
        bandwidth: session?.bandwidth,
        decision: part?.decision || "directplay",
        videoResolution: media?.videoResolution,
        videoCodec: media?.videoCodec,
        audioCodec: media?.audioCodec,
        audioChannels: media?.audioChannels,
        container: media?.container,
        videoDecision: transcode?.videoDecision,
        audioDecision: transcode?.audioDecision,
        transcodeSpeed: transcode?.speed,
        transcodeProgress: transcode?.progress,
        transcodeHwEncoding: toBool(transcode?.transcodeHwEncoding),
        sourceVideoCodec: transcode?.sourceVideoCodec,
        sourceAudioCodec: transcode?.sourceAudioCodec,
      };
    });
  }

  async function getRecentlyAdded(limit = 20): Promise<PlexRecentItem[]> {
    const data = await request("/library/recentlyAdded", {
      params: { "X-Plex-Container-Size": limit },
    });
    return parseMetadataArray(data?.MediaContainer?.Metadata).map((item) => ({
      ratingKey: item.ratingKey ?? "",
      title: item.title ?? "",
      year: item.year,
      thumb: item.thumb,
      type: item.type ?? "",
      addedAt: item.addedAt ?? 0,
    }));
  }

  // ─── Media browsing ────────────────────────────────────────────────────────

  async function getItems(
    sectionId: string,
    options: { offset?: number; size?: number; title?: string; type?: number } = {},
  ): Promise<{ items: PlexMediaItem[]; total: number }> {
    const { offset = 0, size = 50, title, type } = options;
    const data = await request(`/library/sections/${sectionId}/all`, {
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
      // Type filter
      if (type) {
        const itemType = item.type ? SECTION_TYPE_MAP[item.type] : undefined;
        if (itemType && itemType !== type) continue;
      }

      // Title filter
      if (titleLower && !(item.title ?? "").toLowerCase().includes(titleLower)) continue;

      // Media property filters — check Media[0]
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
    const data = await request(`/library/metadata/${ratingKey}`);
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
      media,
    };
  }

  // ─── Metadata children ─────────────────────────────────────────────────────

  async function getMetadataChildren(ratingKey: string): Promise<PlexChildItem[]> {
    const data = await request(`/library/metadata/${ratingKey}/children`);
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

  // ─── Overlay operations ────────────────────────────────────────────────────

  async function getItemFullDetail(ratingKey: string): Promise<PlexMediaFullDetail> {
    const data = await request(`/library/metadata/${ratingKey}`);
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
      guids,
      media,
    };
  }

  async function downloadPoster(thumbPath: string): Promise<Buffer> {
    const res = await requestRaw(thumbPath);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async function uploadPoster(ratingKey: string, imageBuffer: Buffer): Promise<void> {
    const reqUrl = new URL(`/library/metadata/${ratingKey}/posters`, url);
    reqUrl.searchParams.set("X-Plex-Token", token);

    const res = await fetch(reqUrl.toString(), {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "image/jpeg",
        "X-Plex-Client-Identifier": "tinkerbell",
        "X-Plex-Product": "tinkerbell",
        "X-Plex-Version": "1.0.0",
      },
      body: new Uint8Array(imageBuffer),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Plex API POST /library/metadata/${ratingKey}/posters → ${res.status}\n${body}`);
    }
  }

  async function getPosters(ratingKey: string): Promise<PlexPoster[]> {
    const data = await request(`/library/metadata/${ratingKey}/posters`);
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((p: Record<string, unknown>) => ({
      key: p.key as string,
      selected: p.selected === true || p.selected === "1",
      ratingKey: p.ratingKey as string,
    }));
  }

  async function selectPoster(ratingKey: string, posterUrl: string): Promise<void> {
    await request(`/library/metadata/${ratingKey}/posters`, {
      method: "PUT",
      params: { url: posterUrl },
    });
  }

  // ─── Streaming / transcode control ────────────────────────────────────────

  async function startTranscodeSession(ratingKey: string, sessionId: string, clientId: string): Promise<string> {
    const res = await requestRaw("/video/:/transcode/universal/start.m3u8", {
      params: {
        path: `/library/metadata/${ratingKey}`,
        mediaIndex: 0,
        partIndex: 0,
        protocol: "hls",
        fastSeek: 1,
        directPlay: 0,
        directStream: 0,
        offset: 0,
        videoQuality: 75,
        videoResolution: "1920x1080",
        maxVideoBitrate: 8000,
        subtitleSize: 100,
        audioBoost: 100,
        session: sessionId,
        "X-Plex-Platform": "Chrome",
      },
      headers: { "X-Plex-Client-Identifier": clientId },
    });
    return res.text();
  }

  async function stopTranscodeSession(sessionId: string): Promise<void> {
    try {
      await requestRaw("/video/:/transcode/universal/stop", {
        params: { session: sessionId },
      });
    } catch {
      // Session may already be stopped
    }
  }

  async function fetchStreamUrl(relativeUrl: string, clientId: string, fetchSignal?: AbortSignal): Promise<Response> {
    const reqUrl = new URL(relativeUrl, url);
    reqUrl.searchParams.set("X-Plex-Token", token);

    return fetch(reqUrl.toString(), {
      signal: fetchSignal || signal,
      headers: {
        "X-Plex-Client-Identifier": clientId,
        "X-Plex-Product": "tinkerbell-stress",
        "X-Plex-Version": "1.0.0",
      },
    });
  }

  async function reportTimeline(
    ratingKey: string,
    clientId: string,
    opts: { state: string; time: number; duration: number; session?: string },
  ): Promise<void> {
    try {
      const params: Record<string, string | number> = {
        ratingKey,
        key: `/library/metadata/${ratingKey}`,
        state: opts.state,
        time: opts.time,
        duration: opts.duration,
        "X-Plex-Client-Identifier": clientId,
        "X-Plex-Product": "tinkerbell-stress",
        "X-Plex-Device": "tinkerbell-stress",
        "X-Plex-Device-Name": "Tinkerbell Stress Test",
        "X-Plex-Platform": "Chrome",
      };
      if (opts.session) {
        params.containerKey = `/video/:/transcode/universal/session/${opts.session}`;
      }
      await request("/:/timeline", {
        params,
        headers: { "X-Plex-Client-Identifier": clientId },
      });
    } catch {
      // Timeline updates are best-effort
    }
  }

  async function markUnwatched(ratingKey: string): Promise<void> {
    await request("/:/unscrobble", {
      params: {
        key: ratingKey,
        identifier: "com.plexapp.plugins.library",
      },
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    getSections,
    getIdentity,
    getManagedHubs,
    moveHub,
    unpinFromHomepage,
    fetchAllItems,
    fetchItemsSorted,
    fetchGroupedByField,
    fetchItemsByFilter,
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
    getFilterFieldValues,
    getActiveSessions,
    getRecentlyAdded,
    getItems,
    getItemsFiltered,
    getItemDetail,
    getMetadataChildren,
    getItemFullDetail,
    downloadPoster,
    uploadPoster,
    getPosters,
    selectPoster,
    allItems,
    allItemsWithGuids,
    startTranscodeSession,
    stopTranscodeSession,
    fetchStreamUrl,
    reportTimeline,
    markUnwatched,
  };
}

export type PlexClient = ReturnType<typeof createPlexClient>;
