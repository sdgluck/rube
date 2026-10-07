/**
 * URLs for the server's image and video routes.
 *
 * In the browser these are the relative paths they always were. In the native
 * app they are absolute, and carry the media token — an `<img>` can't send the
 * `Authorization` header the rest of the app uses. See `@tinkerbell/native-client`.
 */
import { mediaUrl } from "@tinkerbell/native-client";

/** A Plex thumb or art path, through the server's image proxy. */
export function plexImageUrl(path: string): string {
  return mediaUrl(`/api/plex-image?path=${encodeURIComponent(path)}`);
}

export function prerollThumbUrl(id: string): string {
  return mediaUrl(`/api/prerolls/${id}/thumb`);
}

export function prerollPreviewUrl(id: string): string {
  return mediaUrl(`/api/prerolls/${id}/preview`);
}
