/**
 * Plex user lifecycle — everything plex.tv lets a server owner do to the
 * people they share with: invite, re-share, restrict, unshare, and manage
 * Plex Home profiles.
 *
 * Kept apart from `sharing.ts`, which is the narrow slice the personalization
 * jobs own (read the shares, write the label filters). None of this is
 * documented by Plex; every read tolerates a missing or reshaped payload
 * rather than failing the page, and every write surfaces its HTTP status so
 * callers can tell "already shared" (422) from "rate limited" (429).
 */

import type { PlexHttp } from "./http.ts";
import { createPlexTvRequest, plexTvXmlParser as xmlParser, toArray } from "./plextv.ts";
import { plexUserRecordRawSchema, plexSharedServerFullRawSchema, plexInviteRawSchema } from "./schemas.ts";
import type {
  InviteUserOptions,
  PlexInvite,
  PlexShareFilters,
  PlexShareSettings,
  PlexSharedServerFull,
  PlexUserRecord,
} from "./types.ts";

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** plex.tv wants `1`/`0`, not `true`/`false`, on the legacy query-param form. */
function toFlag(v: boolean | undefined): number | undefined {
  return v === undefined ? undefined : v ? 1 : 0;
}

export function createUsersModule(http: PlexHttp) {
  const plexTvRequest = createPlexTvRequest(http);

  function parseUserRecord(raw: unknown): PlexUserRecord | null {
    const parsed = plexUserRecordRawSchema.safeParse(raw);
    if (!parsed.success) return null;
    const d = parsed.data;
    if (!d.id) return null;
    const username = str(d.username || d.title || d.friendlyName);
    return {
      id: d.id,
      username,
      title: str(d.title || d.friendlyName || username),
      email: str(d.email),
      thumb: str(d.thumb),
      home: toBool(d.home),
      restricted: toBool(d.restricted),
      protected: toBool(d.protected),
    };
  }

  /** Friends — accounts the server is shared with. XML, despite the Accept header. */
  async function listFriends(): Promise<PlexUserRecord[]> {
    const data = await plexTvRequest("/api/users/");
    const xml: string = data?._raw || "";
    if (!xml) return [];
    const parsed = xmlParser.parse(xml) as { MediaContainer?: { User?: unknown[] } };
    return toArray(parsed.MediaContainer?.User)
      .map(parseUserRecord)
      .filter((u): u is PlexUserRecord => u !== null);
  }

  /** Plex Home members, including managed (restricted) profiles. Excludes the owner. */
  async function listHomeUsers(): Promise<PlexUserRecord[]> {
    const data = await plexTvRequest("/api/v2/home/users");
    const raw = data?.users ?? (Array.isArray(data) ? data : []);
    const out: PlexUserRecord[] = [];
    for (const entry of raw) {
      if (toBool((entry as Record<string, unknown>).admin)) continue;
      if (toBool((entry as Record<string, unknown>).guest)) continue;
      const user = parseUserRecord(entry);
      if (user) out.push({ ...user, home: true });
    }
    return out;
  }

  /**
   * Every share on this server, with the settings and filters in force and
   * the shared-server id the section and unshare endpoints are keyed by.
   */
  async function getSharedServersFull(machineIdentifier: string): Promise<PlexSharedServerFull[]> {
    const data = await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers`);
    const xml: string = data?._raw || "";
    if (!xml) return [];

    const root = xmlParser.parse(xml) as { MediaContainer?: { SharedServer?: unknown[] } };
    const out: PlexSharedServerFull[] = [];

    for (const node of toArray(root.MediaContainer?.SharedServer)) {
      const parsed = plexSharedServerFullRawSchema.safeParse(node);
      if (!parsed.success) continue;
      const d = parsed.data;
      if (!d.userID || d.id === undefined) continue;

      const sections = toArray((node as { Section?: unknown[] }).Section) as Array<{
        key?: string | number;
        shared?: string | number;
      }>;
      const librarySectionIds: number[] = [];
      for (const s of sections) {
        if (!toBool(s.shared)) continue;
        const key = Number(s.key);
        if (Number.isFinite(key)) librarySectionIds.push(key);
      }

      out.push({
        sharedServerId: d.id,
        userId: d.userID,
        username: str(d.username),
        email: str(d.email),
        // Absent means accepted: plex.tv only emits the attribute while an
        // invite is outstanding on some server versions.
        accepted: d.accepted === undefined ? true : toBool(d.accepted),
        allowSync: toBool(d.allowSync),
        allowTuners: toBool(d.allowTuners),
        allowChannels: toBool(d.allowChannels),
        allowCameraUpload: toBool(d.allowCameraUpload),
        filterMovies: str(d.filterMovies),
        filterTelevision: str(d.filterTelevision),
        filterMusic: str(d.filterMusic),
        librarySectionIds,
      });
    }
    return out;
  }

  /**
   * Invites we sent and invites sent to us. Two endpoints; either can be
   * missing on an account that has never used one, so each degrades to empty
   * independently rather than taking the other down with it.
   */
  async function listPendingInvites(): Promise<PlexInvite[]> {
    const load = async (path: string, direction: PlexInvite["direction"]): Promise<PlexInvite[]> => {
      try {
        const data = await plexTvRequest(path);
        const raw = Array.isArray(data) ? data : (data?.friends ?? data?.invites ?? []);
        const out: PlexInvite[] = [];
        for (const entry of raw) {
          const parsed = plexInviteRawSchema.safeParse(entry);
          if (!parsed.success) continue;
          const d = parsed.data;
          if (!d.id) continue;
          out.push({
            id: d.id,
            direction,
            username: str(d.username || d.title),
            email: str(d.email),
            thumb: str(d.thumb),
            createdAt: d.createdAt,
          });
        }
        return out;
      } catch {
        return [];
      }
    };

    const [sent, received] = await Promise.all([
      load("/api/v2/friends/requested", "sent"),
      load("/api/v2/friends/requests", "received"),
    ]);
    return [...sent, ...received];
  }

  /**
   * Share the server with someone, inviting them by email if they aren't on
   * the account yet. An empty `librarySectionIds` shares every library.
   *
   * A 422 means the server is already shared with that user — plex.tv's way
   * of saying "no-op", and worth distinguishing from a real failure.
   */
  async function inviteUser({
    machineIdentifier,
    invitedEmail,
    invitedId,
    librarySectionIds,
    settings,
    filters,
  }: InviteUserOptions): Promise<void> {
    await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers`, {
      method: "POST",
      body: {
        server_id: machineIdentifier,
        shared_server: {
          library_section_ids: librarySectionIds,
          ...(invitedEmail ? { invited_email: invitedEmail } : {}),
          ...(invitedId ? { invited_id: invitedId } : {}),
        },
        sharing_settings: {
          allowSync: toFlag(settings?.allowSync) ?? 0,
          allowTuners: toFlag(settings?.allowTuners) ?? 0,
          allowChannels: toFlag(settings?.allowChannels) ?? 0,
          allowCameraUpload: toFlag(settings?.allowCameraUpload) ?? 0,
          filterMovies: filters?.filterMovies ?? "",
          filterTelevision: filters?.filterTelevision ?? "",
          filterMusic: filters?.filterMusic ?? "",
        },
      },
    });
  }

  /** Change *which* libraries a user can see. The only endpoint that does this. */
  async function updateSharedSections(
    machineIdentifier: string,
    sharedServerId: number,
    librarySectionIds: number[],
  ): Promise<void> {
    await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers/${sharedServerId}`, {
      method: "PUT",
      body: {
        server_id: machineIdentifier,
        shared_server: { library_section_ids: librarySectionIds },
      },
    });
  }

  /**
   * Downloads / Live TV / channels / camera upload, and the filter strings.
   * The legacy `/api/friends/{userId}` form takes them as query params and is
   * what this repo has always used for filters; omitted params are left alone.
   */
  async function updateShareSettings(
    userId: number,
    settings: PlexShareSettings & PlexShareFilters = {},
  ): Promise<void> {
    await plexTvRequest(`/api/friends/${userId}`, {
      method: "PUT",
      params: {
        allowSync: toFlag(settings.allowSync),
        allowTuners: toFlag(settings.allowTuners),
        allowChannels: toFlag(settings.allowChannels),
        allowCameraUpload: toFlag(settings.allowCameraUpload),
        filterMovies: settings.filterMovies,
        filterTelevision: settings.filterTelevision,
        filterMusic: settings.filterMusic,
      },
    });
  }

  /** Revoke access to this server. The friendship, and any other share, survives. */
  async function unshareServer(machineIdentifier: string, sharedServerId: number): Promise<void> {
    await plexTvRequest(`/api/servers/${machineIdentifier}/shared_servers/${sharedServerId}`, { method: "DELETE" });
  }

  /** Remove the friend outright — every share with them goes with it. */
  async function removeFriend(userId: number): Promise<void> {
    await plexTvRequest(`/api/v2/friends/${userId}`, { method: "DELETE" });
  }

  async function cancelInvite(inviteId: number): Promise<void> {
    await plexTvRequest(`/api/v2/friends/requested/${inviteId}`, { method: "DELETE" });
  }

  async function acceptInvite(inviteId: number): Promise<void> {
    await plexTvRequest(`/api/v2/friends/requests/${inviteId}`, { method: "PUT" });
  }

  async function declineInvite(inviteId: number): Promise<void> {
    await plexTvRequest(`/api/v2/friends/requests/${inviteId}`, { method: "DELETE" });
  }

  /** A managed profile: lives in this Home, has no Plex account of its own. */
  async function createManagedUser(title: string): Promise<void> {
    await plexTvRequest("/api/home/users", { method: "POST", params: { title } });
  }

  /** Pull an existing Plex account into this Home. */
  async function addExistingUserToHome(invitedEmail: string): Promise<void> {
    await plexTvRequest("/api/home/users", { method: "POST", params: { invitedEmail } });
  }

  async function removeHomeUser(userId: number): Promise<void> {
    await plexTvRequest(`/api/home/users/${userId}`, { method: "DELETE" });
  }

  /** Write-only — Plex never gives a PIN back, only whether one is set. */
  async function setHomeUserPin(userId: number, pin: string): Promise<void> {
    await plexTvRequest(`/api/v2/home/users/restricted/${userId}`, { method: "PUT", params: { pin } });
  }

  async function clearHomeUserPin(userId: number): Promise<void> {
    await plexTvRequest(`/api/v2/home/users/restricted/${userId}`, { method: "DELETE" });
  }

  return {
    listFriends,
    listHomeUsers,
    getSharedServersFull,
    listPendingInvites,
    inviteUser,
    updateSharedSections,
    updateShareSettings,
    unshareServer,
    removeFriend,
    cancelInvite,
    acceptInvite,
    declineInvite,
    createManagedUser,
    addExistingUserToHome,
    removeHomeUser,
    setHomeUserPin,
    clearHomeUserPin,
  };
}
