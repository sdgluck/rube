import { XMLParser } from "fast-xml-parser";
import { httpRequest, HttpError } from "@tinkerbell/http";
import type { PlexHttp } from "./http.ts";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
import { plexSharedServerRawSchema } from "./schemas.ts";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Containers we want to walk return as arrays even when there's only one
  // child, so downstream code doesn't have to special-case 1-vs-N.
  isArray: (name) => name === "User" || name === "Server" || name === "SharedServer" || name === "Section",
});

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
import type {
  PlexAccount,
  PlexHistoryItem,
  PlexSharing,
  PlexSharedServerDetail,
  RequestOptions,
  WatchHistoryOptions,
} from "./types.ts";

export function createSharingModule(http: PlexHttp) {
  async function plexTvRequest(path: string, { method = "GET", params = {}, headers = {} }: RequestOptions = {}) {
    const reqUrl = new URL(path, "https://plex.tv");
    reqUrl.searchParams.set("X-Plex-Token", http.token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) reqUrl.searchParams.set(k, String(v));
    }

    let res: Response;
    try {
      res = await httpRequest({
        url: reqUrl,
        retries: 3,
        timeoutMs: 15_000,
        init: {
          method,
          signal: http.signal,
          headers: {
            Accept: "application/json",
            "X-Plex-Client-Identifier": "tinkerbell",
            "X-Plex-Product": "tinkerbell",
            "X-Plex-Version": "1.0.0",
            ...headers,
          },
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${err.status}`);
        throw new Error(`Plex.tv API ${method} ${path} → ${err.message}`);
      }
      http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${errorMessage(err)}`);
      throw err;
    }

    http.onHealth?.("Plex.tv", "ok", `${method} ${path} → ${res.status}`);

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
        const parsed = xmlParser.parse(xml) as { MediaContainer?: { User?: unknown[] } };
        const users = toArray(parsed.MediaContainer?.User) as Array<{
          id?: string | number;
          username?: string;
          title?: string;
          Server?: unknown[];
        }>;
        for (const user of users) {
          const servers = toArray(user.Server) as Array<{ machineIdentifier?: string }>;
          if (!servers.some((s) => s.machineIdentifier === machineIdentifier)) continue;
          const idRaw = user.id;
          if (idRaw === undefined || idRaw === null) continue;
          const id = typeof idRaw === "number" ? idRaw : parseInt(String(idRaw), 10);
          if (!Number.isFinite(id)) continue;
          seenIds.add(id);
          results.push({
            id,
            userId: id,
            username: user.username || user.title || "",
            machineIdentifier,
          });
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

  /** Set raw filter strings verbatim — used to restore a snapshotted state. */
  async function setSharingFilters(userId: number, filterMovies: string, filterTelevision: string): Promise<void> {
    await plexTvRequest(`/api/friends/${userId}`, {
      method: "PUT",
      params: { filterMovies, filterTelevision },
    });
  }

  async function getSharedServerDetails(machineIdentifier: string): Promise<PlexSharedServerDetail[]> {
    const data = await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers`);
    const xml: string = data?._raw || "";
    if (!xml) return [];

    const root = xmlParser.parse(xml) as { MediaContainer?: { SharedServer?: unknown[] } };
    const shared = toArray(root.MediaContainer?.SharedServer) as Array<{
      userID?: string | number;
      filterMovies?: string;
      filterTelevision?: string;
      Section?: unknown[];
    }>;

    const out: PlexSharedServerDetail[] = [];
    for (const node of shared) {
      const sections = toArray(node.Section) as Array<{ key?: string | number; shared?: string | number }>;
      const sectionIds: number[] = [];
      for (const s of sections) {
        if (String(s.shared) !== "1") continue;
        const key = typeof s.key === "number" ? s.key : parseInt(String(s.key ?? ""), 10);
        if (Number.isFinite(key)) sectionIds.push(key);
      }

      const userIdNum = typeof node.userID === "number" ? node.userID : parseInt(String(node.userID ?? ""), 10);
      const parsed = plexSharedServerRawSchema.safeParse({
        userID: Number.isFinite(userIdNum) ? userIdNum : undefined,
        filterMovies: node.filterMovies ?? "",
        filterTelevision: node.filterTelevision ?? "",
        librarySectionIDs: sectionIds.join(","),
      });
      if (!parsed.success || !parsed.data.userID) continue;

      out.push({
        userId: parsed.data.userID,
        filterMovies: parsed.data.filterMovies ?? "",
        filterTelevision: parsed.data.filterTelevision ?? "",
        librarySectionIds: sectionIds,
      });
    }
    return out;
  }

  async function getWatchHistory({
    accountID,
    librarySectionID,
    limit = 50,
    offset,
    viewedAfter,
  }: WatchHistoryOptions = {}): Promise<PlexHistoryItem[]> {
    const params: Record<string, string | number> = {
      sort: "viewedAt:desc",
      "X-Plex-Container-Size": limit,
    };
    if (offset) params["X-Plex-Container-Start"] = offset;
    if (accountID) params.accountID = accountID;
    if (librarySectionID) params.librarySectionID = librarySectionID;
    // Plex's filter operator suffix. `viewedAt>=` narrows server-side, which
    // keeps an incremental backfill from walking years of history every run.
    if (viewedAfter) params["viewedAt>"] = viewedAfter;

    const data = await http.request("/status/sessions/history/all", { params });
    return (data?.MediaContainer?.Metadata || []).map((item: Record<string, unknown>) => ({
      type: item.type as string,
      ratingKey: item.ratingKey as string,
      title: item.title as string,
      year: item.year as number | undefined,
      grandparentTitle: item.grandparentTitle as string | undefined,
      grandparentRatingKey: item.grandparentRatingKey as string | undefined,
      accountID: item.accountID as number | undefined,
      viewedAt: item.viewedAt as number | undefined,
      librarySectionID: item.librarySectionID == null ? undefined : String(item.librarySectionID),
    }));
  }

  async function getAccounts(): Promise<PlexAccount[]> {
    const data = await http.request("/accounts");
    return data?.MediaContainer?.Account || [];
  }

  async function getOwner(): Promise<{ id: number; username: string; title: string } | null> {
    try {
      const data = await plexTvRequest("/api/v2/user");
      if (!data || typeof data !== "object") return null;
      const id = Number(data.id);
      if (!Number.isFinite(id) || id <= 0) return null;
      const username = (data.username || data.title || data.friendlyName || "").toString();
      const title = (data.title || data.friendlyName || username).toString();
      if (!username) return null;
      return { id, username, title };
    } catch {
      return null;
    }
  }

  return {
    getSharings,
    setSharingRestrictions,
    clearSharingRestrictions,
    setSharingFilters,
    getSharedServerDetails,
    getWatchHistory,
    getAccounts,
    getOwner,
  };
}
