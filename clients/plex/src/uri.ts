/**
 * The `server://…` URI Plex wants whenever items are named as the *content* of
 * something — creating a collection or a playlist, or adding to either.
 *
 * Not a URL: the machine identifier addresses the server to itself, and the
 * rating keys are a single comma-joined path segment rather than a list
 * parameter. Shared between collections and playlists because getting it
 * subtly wrong in one of them produces an empty container rather than an
 * error, which is a genuinely hard thing to debug from the outside.
 */
export function libraryUri(machineId: string, ratingKeys: string[]): string {
  return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;
}

/**
 * How many rating keys go into one create/add call.
 *
 * The URI is a path segment, so every key lengthens the request line rather
 * than a body. Plex has no documented ceiling and servers behind a proxy hit
 * one well before Plex itself does, so a large playlist is created from the
 * first chunk and extended with the rest.
 */
export const URI_CHUNK_SIZE = 200;

/** Split rating keys into request-sized chunks. */
export function chunkRatingKeys(ratingKeys: string[], size = URI_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ratingKeys.length; i += size) out.push(ratingKeys.slice(i, i + size));
  return out;
}
