import type { PlexHttp } from "./http.ts";

export function createStreamingModule(http: PlexHttp) {
  async function startTranscodeSession(ratingKey: string, sessionId: string, clientId: string): Promise<string> {
    const res = await http.requestRaw("/video/:/transcode/universal/start.m3u8", {
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
      await http.requestRaw("/video/:/transcode/universal/stop", {
        params: { session: sessionId },
      });
    } catch {
      // Session may already be stopped
    }
  }

  async function fetchStreamUrl(relativeUrl: string, clientId: string, fetchSignal?: AbortSignal): Promise<Response> {
    const reqUrl = new URL(relativeUrl, http.url);
    reqUrl.searchParams.set("X-Plex-Token", http.token);

    return fetch(reqUrl.toString(), {
      signal: fetchSignal || http.signal,
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
      await http.request("/:/timeline", {
        params,
        headers: { "X-Plex-Client-Identifier": clientId },
      });
    } catch {
      // Timeline updates are best-effort
    }
  }

  async function markUnwatched(ratingKey: string): Promise<void> {
    await http.request("/:/unscrobble", {
      params: {
        key: ratingKey,
        identifier: "com.plexapp.plugins.library",
      },
    });
  }

  return { startTranscodeSession, stopTranscodeSession, fetchStreamUrl, reportTimeline, markUnwatched };
}
