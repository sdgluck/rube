/**
 * URLs for the server's image and video routes — same-origin paths, which the
 * session cookie authenticates like any other request.
 */

/** A Plex thumb or art path, through the server's image proxy. */
export function plexImageUrl(path: string): string {
  return `/api/plex-image?path=${encodeURIComponent(path)}`;
}

export function prerollThumbUrl(id: string): string {
  return `/api/prerolls/${id}/thumb`;
}

export function prerollPreviewUrl(id: string): string {
  return `/api/prerolls/${id}/preview`;
}
