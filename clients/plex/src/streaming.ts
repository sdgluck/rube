import type { PlexHttp } from "./http.ts";

/**
 * The headers that make a simulated player look like a *distinct device* to
 * Plex.
 *
 * This is not cosmetic. Plex tears down an existing transcode session when what
 * it believes is the same device starts playing something else — so a harness
 * whose sessions differ only by `X-Plex-Client-Identifier`, and otherwise
 * inherit the shared `rube` product identity, kills its own previous
 * session on every step. Observed directly: step 1's playlist began returning
 * 404 the instant step 2 started, and every earlier session followed suit, so
 * the ramp measured one live stream however many it had started.
 *
 * Every request belonging to a simulated client carries the full set.
 */
function clientHeaders(clientId: string): Record<string, string> {
  return {
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": "rube-stress",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Device": clientId,
    "X-Plex-Device-Name": `Rube Stress ${clientId}`,
    "X-Plex-Platform": "Chrome",
  };
}

export function createStreamingModule(http: PlexHttp) {
  /**
   * The transcode parameters, shared by `decision` and `start.m3u8`.
   *
   * They must match between the two calls: the decision is recorded against
   * this session and the start is expected to be the same playback.
   */
  function transcodeParams(ratingKey: string, sessionId: string) {
    return {
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
    };
  }

  /**
   * Start a transcode session, the way a Plex client actually does it.
   *
   * The `decision` call is not optional and not a formality — it is what makes
   * the session durable. Without it `start.m3u8` still returns 200 and still
   * hands back a valid-looking playlist, but Plex treats the session as a
   * throwaway and discards it the moment the next transcode starts: the
   * previous session's playlist begins returning 404.
   *
   * That was measured, not guessed. Twelve sessions started in sequence with
   * distinct client identifiers, devices, products, platforms, session
   * identifiers and media items never had more than one alive, and the
   * server's own `/transcode/sessions` never listed more than one. Adding this
   * single call — changing nothing else — took the same test to five out of
   * five concurrent, with `/transcode/sessions` growing in step. Removing it
   * again drops straight back to one.
   *
   * The failure mode matters for anything that reads this code later: the
   * omission is invisible at the call site. One session works perfectly, so it
   * only shows up when something tries to run two.
   */
  async function startTranscodeSession(ratingKey: string, sessionId: string, clientId: string): Promise<string> {
    const params = transcodeParams(ratingKey, sessionId);
    const headers = clientHeaders(clientId);

    await http.request("/video/:/transcode/universal/decision", { params, headers });

    const res = await http.requestRaw("/video/:/transcode/universal/start.m3u8", { params, headers });
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

  /**
   * `relativeUrl` is resolved against the server origin, so an absolute URL —
   * which is what Plex puts in an HLS master playlist's variant lines — passes
   * through unchanged. Callers must not try to join paths by hand.
   *
   * `rangeFrom` asks for a byte range. Direct play uses it to walk through the
   * file: without it every read starts at byte 0 and measures the same cached
   * opening seconds over and over, which is not the load a real client applies.
   */
  async function fetchStreamUrl(
    relativeUrl: string,
    clientId: string,
    fetchSignal?: AbortSignal,
    rangeFrom?: number,
  ): Promise<Response> {
    const reqUrl = new URL(relativeUrl, http.url);
    reqUrl.searchParams.set("X-Plex-Token", http.token);

    const headers: Record<string, string> = clientHeaders(clientId);
    if (rangeFrom != null && rangeFrom > 0) headers.Range = `bytes=${rangeFrom}-`;

    return fetch(reqUrl.toString(), {
      signal: fetchSignal || http.signal,
      headers,
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
        ...clientHeaders(clientId),
      };
      if (opts.session) {
        params.containerKey = `/video/:/transcode/universal/session/${opts.session}`;
      }
      await http.request("/:/timeline", {
        params,
        headers: clientHeaders(clientId),
      });
    } catch {
      // Timeline updates are best-effort
    }
  }

  /**
   * Absolute form of a stream URL, using the same resolution `fetchStreamUrl`
   * applies. Exposed so callers can resolve playlist-relative URLs through the
   * URL parser without needing to know the server origin themselves.
   */
  function resolveStreamUrl(relativeUrl: string): string {
    return new URL(relativeUrl, http.url).toString();
  }

  async function markUnwatched(ratingKey: string): Promise<void> {
    await http.request("/:/unscrobble", {
      params: {
        key: ratingKey,
        identifier: "com.plexapp.plugins.library",
      },
    });
  }

  return {
    startTranscodeSession,
    stopTranscodeSession,
    fetchStreamUrl,
    resolveStreamUrl,
    reportTimeline,
    markUnwatched,
  };
}
