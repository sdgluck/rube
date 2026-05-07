import type { PlexHttp } from "./http.ts";
import { parseMetadataArray } from "./schemas.ts";
import type { PlexSession, PlexRecentItem } from "./types.ts";

export function createSessionsModule(http: PlexHttp) {
  async function getActiveSessions(): Promise<PlexSession[]> {
    const data = await http.request("/status/sessions");
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
        ratingKey: item.ratingKey,
        parentRatingKey: item.parentRatingKey,
        grandparentRatingKey: item.grandparentRatingKey,
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
    const data = await http.request("/library/recentlyAdded", {
      params: { "X-Plex-Container-Size": limit },
    });
    return parseMetadataArray(data?.MediaContainer?.Metadata).map((item) => {
      const media = item.Media?.[0];
      const part = media?.Part?.[0];
      return {
        ratingKey: item.ratingKey ?? "",
        title: item.title ?? "",
        year: item.year,
        thumb: item.thumb,
        type: item.type ?? "",
        addedAt: item.addedAt ?? 0,
        grandparentTitle: item.grandparentTitle,
        parentTitle: item.parentTitle,
        container: media?.container,
        videoResolution: media?.videoResolution,
        fileSize: part?.size,
      };
    });
  }

  return { getActiveSessions, getRecentlyAdded };
}
