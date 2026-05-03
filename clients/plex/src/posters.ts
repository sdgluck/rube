import type { PlexHttp } from "./http.ts";
import type { PlexPoster } from "./types.ts";

export function createPostersModule(http: PlexHttp) {
  async function downloadPoster(thumbPath: string): Promise<Buffer> {
    const res = await http.requestRaw(thumbPath);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async function uploadPoster(ratingKey: string, imageBuffer: Buffer): Promise<void> {
    const reqUrl = new URL(`/library/metadata/${ratingKey}/posters`, http.url);
    reqUrl.searchParams.set("X-Plex-Token", http.token);

    const res = await fetch(reqUrl.toString(), {
      method: "POST",
      signal: http.signal,
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
    const data = await http.request(`/library/metadata/${ratingKey}/posters`);
    const metadata = data?.MediaContainer?.Metadata || [];
    return metadata.map((p: Record<string, unknown>) => ({
      key: p.key as string,
      selected: p.selected === true || p.selected === "1",
      ratingKey: p.ratingKey as string,
    }));
  }

  async function selectPoster(ratingKey: string, posterUrl: string): Promise<void> {
    await http.request(`/library/metadata/${ratingKey}/posters`, {
      method: "PUT",
      params: { url: posterUrl },
    });
  }

  return { downloadPoster, uploadPoster, getPosters, selectPoster };
}
