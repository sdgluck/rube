/**
 * Building one collection's poster: gathering the member art, deriving the
 * palette, and deciding whether anything actually needs uploading.
 *
 * Shared by the `collection-art` command and the wizard's live preview, which
 * is the point — a preview that renders through a different path is a preview
 * of something else.
 */
import type { PlexClient } from "@rube/plex";
import { artworkHash, type CollectionArtworkRow } from "@rube/domain.collections";
import { resolvePosterTemplate, type CollectionPosterTemplateId, type PresentationConfig } from "@rube/contracts";
import {
  derivePalette,
  fetchPosterUrl,
  normalizePosterUpload,
  renderCollectionPoster,
  type Palette,
} from "@rube/posters";
import { mapConcurrent } from "#jobs/concurrency.ts";

/**
 * How many member posters are fetched per collection.
 *
 * Six fills the widest mosaic. Fetching the whole collection would be a
 * hundred thumbnail downloads for a six-cell grid, and the palette is no
 * better derived from a hundred images than from six.
 */
export const MEMBER_POSTER_SAMPLE = 6;

/** Member thumbnails in flight per collection. */
const THUMB_CONCURRENCY = 3;

export interface PosterMember {
  ratingKey: string;
  /** Plex thumb path, e.g. `/library/metadata/123/thumb/456`. */
  thumb?: string;
}

export interface BuiltPoster {
  buffer: Buffer;
  /** Covers template, title, palette and member art — see the ledger table. */
  inputHash: string;
  template: CollectionPosterTemplateId | "url" | "asset";
  palette: Palette;
  memberPostersUsed: number;
}

/**
 * Download the first few members' posters.
 *
 * A member with no thumb, or one Plex refuses, is simply absent — every
 * template renders from however many turn up, including none.
 */
export async function fetchMemberPosters(
  client: PlexClient,
  members: readonly PosterMember[],
  signal?: AbortSignal,
): Promise<{ buffers: Buffer[]; keys: string[] }> {
  const candidates = members.filter((m) => !!m.thumb).slice(0, MEMBER_POSTER_SAMPLE);
  const results = await mapConcurrent(candidates, THUMB_CONCURRENCY, async (member) => {
    signal?.throwIfAborted();
    try {
      return { key: member.thumb!, buffer: await client.downloadPoster(member.thumb!) };
    } catch {
      return null;
    }
  });
  const ok = results.filter((r): r is { key: string; buffer: Buffer } => r !== null);
  return { buffers: ok.map((r) => r.buffer), keys: ok.map((r) => r.key) };
}

export interface BuildPosterInput {
  presentation: PresentationConfig;
  title: string;
  subtitle?: string;
  memberPosters: Buffer[];
  /** Plex thumb paths of the posters above — the stable half of the hash. */
  memberPosterKeys: string[];
  /**
   * Finds a local asset file for a collection name, when the server has an
   * asset directory configured. Injected rather than read here so this module
   * stays free of the filesystem and testable on buffers alone.
   */
  findAsset?: (name: string) => Promise<{ path: string; buffer: Buffer; mtimeMs: number } | null>;
}

/**
 * Produce the poster bytes and the hash that identifies them.
 *
 * The hash covers everything that changes the image and nothing that doesn't:
 * the *thumb paths* rather than the image bytes, because Plex mints a new
 * thumb path whenever the artwork behind it changes, and hashing megabytes of
 * JPEG per collection per night to learn the same thing would be absurd.
 */
export async function buildCollectionPoster(input: BuildPosterInput): Promise<BuiltPoster | null> {
  const { presentation } = input;
  if (presentation.poster === "none") return null;

  if (presentation.poster === "url") {
    const url = presentation.posterUrl?.trim();
    if (!url) return null;
    const fetched = await fetchPosterUrl(url);
    if (fetched.status === "rejected") throw new Error(`poster URL rejected — ${fetched.reason}`);
    return {
      buffer: fetched.buffer,
      // The URL alone: the bytes behind it are the publisher's business, and
      // a curated URL that changes is a poster the user chose to change.
      inputHash: artworkHash(["url", url]),
      template: "url",
      palette: await derivePalette([], presentation.accentColor),
      memberPostersUsed: 0,
    };
  }

  if (presentation.poster === "asset") {
    if (!input.findAsset) throw new Error("no asset directory is configured");
    const found = await input.findAsset(input.title);
    // A missing asset is the normal case, not a fault: an asset directory
    // covers the collections somebody made art for, and the rest are meant to
    // keep whatever poster they already have rather than get a generated one.
    if (!found) return null;

    const normalised = await normalizePosterUpload(found.buffer);
    if (normalised.status === "rejected") throw new Error(`asset ${found.path} rejected — ${normalised.reason}`);

    return {
      buffer: normalised.buffer,
      // Path plus mtime rather than the bytes: it identifies the same image at
      // the same cost as a stat, and a user who replaces the file gets a new
      // hash and therefore a re-upload, which is the whole point of editing it.
      inputHash: artworkHash(["asset", found.path, found.mtimeMs]),
      template: "asset",
      palette: await derivePalette([], presentation.accentColor),
      memberPostersUsed: 0,
    };
  }

  const template = resolvePosterTemplate(presentation.poster, input.memberPosters.length);
  const palette = await derivePalette(input.memberPosters, presentation.accentColor);
  const inputHash = artworkHash([template, input.title, input.subtitle ?? "", palette, input.memberPosterKeys]);

  const buffer = await renderCollectionPoster(template, {
    title: input.title,
    subtitle: input.subtitle,
    memberPosters: input.memberPosters,
    palette,
  });

  return { buffer, inputHash, template, palette, memberPostersUsed: input.memberPosters.length };
}

/**
 * Has this exact image already been uploaded?
 *
 * Guarding on both halves matters: a ledger row can carry a matching hash from
 * a run that computed the poster and then failed to upload it, and treating
 * that as done would leave the collection permanently without artwork.
 */
export function posterAlreadyUploaded(ledger: CollectionArtworkRow | undefined, inputHash: string): boolean {
  return !!ledger?.posterUploadedAt && ledger.inputHash === inputHash;
}
