import type { PlexHttp } from "./http.ts";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
import { plexSharedServerRawSchema } from "./schemas.ts";
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
      res = await fetch(reqUrl.toString(), {
        method,
        signal: http.signal,
        headers: {
          Accept: "application/json",
          "X-Plex-Client-Identifier": "tinkerbell",
          "X-Plex-Product": "tinkerbell",
          "X-Plex-Version": "1.0.0",
          ...headers,
        },
      });
    } catch (err) {
      http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${errorMessage(err)}`);
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      http.onHealth?.("Plex.tv", "error", `${method} ${path} → ${res.status} ${res.statusText}`);
      throw new Error(`Plex.tv API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
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

  async function getSharedServerDetails(machineIdentifier: string): Promise<PlexSharedServerDetail[]> {
    const data = await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers`);
    const xml: string = data?._raw || "";
    if (!xml) return [];

    const sharedRegex = /<SharedServer\s([^>]+?)>([\s\S]*?)<\/SharedServer>|<SharedServer\s([^>]+?)\/>/g;
    const out: PlexSharedServerDetail[] = [];
    let match;
    while ((match = sharedRegex.exec(xml)) !== null) {
      const attrs = match[1] || match[3] || "";
      const inner = match[2] || "";

      const userID = attrs.match(/\buserID="(\d+)"/)?.[1];
      const filterMovies = attrs.match(/\bfilterMovies="([^"]*)"/)?.[1] ?? "";
      const filterTelevision = attrs.match(/\bfilterTelevision="([^"]*)"/)?.[1] ?? "";

      const sectionIds: number[] = [];
      const sectionRegex = /<Section\s([^>]+?)\/?>/g;
      let sMatch;
      while ((sMatch = sectionRegex.exec(inner)) !== null) {
        const sAttrs = sMatch[1];
        const shared = sAttrs.match(/\bshared="(\d+)"/)?.[1];
        if (shared !== "1") continue;
        const keyAttr = sAttrs.match(/\bkey="(\d+)"/)?.[1];
        if (keyAttr) sectionIds.push(parseInt(keyAttr, 10));
      }

      const parsed = plexSharedServerRawSchema.safeParse({
        userID: userID ? parseInt(userID, 10) : undefined,
        filterMovies,
        filterTelevision,
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

  async function getWatchHistory({ accountID, librarySectionID, limit = 50 }: WatchHistoryOptions = {}): Promise<
    PlexHistoryItem[]
  > {
    const params: Record<string, string | number> = {
      sort: "viewedAt:desc",
      "X-Plex-Container-Size": limit,
    };
    if (accountID) params.accountID = accountID;
    if (librarySectionID) params.librarySectionID = librarySectionID;

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
    getSharedServerDetails,
    getWatchHistory,
    getAccounts,
    getOwner,
  };
}
