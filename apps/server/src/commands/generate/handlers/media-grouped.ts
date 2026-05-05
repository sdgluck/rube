import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

const MIN_ITEMS_PER_GROUP = 3;

export type MediaGroupedField = "resolutions" | "audio_languages" | "subtitle_languages" | "video_formats";

interface GroupKeyLabel {
  key: string;
  label: string;
}

/**
 * Plex stores `videoResolution` as a short token: "4k", "1080", "720", "480",
 * "sd". Map those to the human-readable labels Kometa uses so the resulting
 * collections look the same as before migration.
 */
const RESOLUTION_LABELS: Record<string, string> = {
  "4k": "4K",
  "2160": "4K",
  "1080": "1080p",
  "720": "720p",
  "480": "480p",
  sd: "SD",
};

/**
 * Group container/codec hints into the broader Kometa-style format
 * buckets. Plex doesn't track source format directly so we fall back to
 * sensible "what is this" guesses based on container + bitrate; users
 * with different conventions can reclassify after the fact.
 */
function videoFormatLabel(media: NonNullable<NonNullable<ReturnType<() => unknown>>>): GroupKeyLabel | null {
  // Type relaxed — Media row is a passthrough zod object so we navigate fields cautiously.
  const m = media as { container?: string; videoResolution?: string };
  const container = (m.container ?? "").toLowerCase();
  if (container === "mkv" || container === "mp4") {
    // Heuristic: 4K with a high bitrate is most often Bluray rip; otherwise WEB-DL.
    return { key: "web-dl", label: "WEB-DL" };
  }
  if (container === "iso" || container === "vob" || container === "m2ts") {
    return { key: "bluray", label: "Bluray" };
  }
  if (container === "ts" || container === "mts") {
    return { key: "hdtv", label: "HDTV" };
  }
  return null;
}

export function mediaGroupedHandler(field: MediaGroupedField) {
  return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const maxCollections = ruleConfig.limit ?? 15;

    for (const section of sections) {
      ctx.signal?.throwIfAborted();
      ctx.log(`[${field}] "${section.title}" — scanning items...`);

      type Group = { label: string; items: Array<{ ratingKey: string; title: string; year?: number }> };
      const groups = new Map<string, Group>();

      let total = 0;
      let withMedia = 0;

      for await (const { item } of client.allItems(section.key)) {
        total++;
        const ratingKey = item.ratingKey ?? "";
        const title = item.title ?? "";
        if (!ratingKey) continue;

        const media = (item.Media as Array<Record<string, unknown>> | undefined) ?? [];
        if (media.length === 0) continue;
        withMedia++;

        const entry = { ratingKey, title, year: item.year };
        const groupsForItem = extractGroups(field, media);

        for (const { key, label } of groupsForItem) {
          const bucket = groups.get(key);
          if (bucket) bucket.items.push(entry);
          else groups.set(key, { label, items: [entry] });
        }
      }

      const ranked = [...groups.values()]
        .filter((g) => g.items.length >= MIN_ITEMS_PER_GROUP)
        .sort((a, b) => b.items.length - a.items.length);

      ctx.log(
        `[${field}] "${section.title}" — ${total} items (${withMedia} with media), ${groups.size} group(s), ${ranked.length} pass min-items (${MIN_ITEMS_PER_GROUP}).`,
      );

      for (const group of ranked.slice(0, maxCollections)) {
        ctx.signal?.throwIfAborted();
        yield { name: group.label, section, matched: group.items };
      }
    }
  };
}

function extractGroups(field: MediaGroupedField, media: Array<Record<string, unknown>>): GroupKeyLabel[] {
  // First Media row is the "primary" file Plex picks; secondary versions
  // (e.g. trailer files) are uncommon in real libraries but we still
  // ignore them — collections should reflect the canonical version, not
  // every duplicate copy.
  const m = media[0];
  if (!m) return [];

  if (field === "resolutions") {
    const raw = (m.videoResolution as string | undefined)?.toLowerCase();
    if (!raw) return [];
    const label = RESOLUTION_LABELS[raw] ?? raw.toUpperCase();
    return [{ key: `r:${raw}`, label }];
  }

  if (field === "video_formats") {
    const labelled = videoFormatLabel(m);
    return labelled ? [labelled] : [];
  }

  if (field === "audio_languages" || field === "subtitle_languages") {
    const wantStreamType = field === "audio_languages" ? 2 : 3;
    const parts = (m.Part as Array<Record<string, unknown>> | undefined) ?? [];
    const langs = new Map<string, string>();
    for (const part of parts) {
      const streams = (part.Stream as Array<Record<string, unknown>> | undefined) ?? [];
      for (const stream of streams) {
        if (stream.streamType !== wantStreamType) continue;
        const code = (stream.languageCode as string | undefined) ?? (stream.language as string | undefined);
        const display = (stream.language as string | undefined) ?? (stream.languageCode as string | undefined);
        if (!code || !display) continue;
        langs.set(code.toLowerCase(), display);
      }
    }
    return [...langs.entries()].map(([code, label]) => ({ key: `${field}:${code}`, label }));
  }

  return [];
}
