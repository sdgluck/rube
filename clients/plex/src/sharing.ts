import type { PlexHttp } from "./http.ts";
import { createPlexTvRequest, plexTvXmlParser as xmlParser, toArray } from "./plextv.ts";
import { setFilterClause } from "./filters.ts";
import { plexSharedServerRawSchema } from "./schemas.ts";
import type {
  PlexAccount,
  PlexHistoryItem,
  PlexSharing,
  PlexSharedServerDetail,
  WatchHistoryOptions,
} from "./types.ts";

export function createSharingModule(http: PlexHttp) {
  const plexTvRequest = createPlexTvRequest(http);

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

  /**
   * Set the `label=` clause of a user's movie and TV filters.
   *
   * `current` is the user's existing filter strings. Passing them keeps any
   * `contentRating=` clause an admin set alongside the labels — without it
   * this write is wholesale, and a parental rating quietly disappears every
   * time personalization reconciles.
   */
  async function setSharingRestrictions(
    userId: number,
    labels: string[],
    current?: { filterMovies?: string; filterTelevision?: string },
  ): Promise<void> {
    await plexTvRequest(`/api/friends/${userId}`, {
      method: "PUT",
      params: {
        filterMovies: setFilterClause(current?.filterMovies, "label", labels),
        filterTelevision: setFilterClause(current?.filterTelevision, "label", labels),
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
      accessToken?: string;
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
        accessToken: node.accessToken || undefined,
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
