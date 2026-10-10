import { z } from "zod";

// Permissive: passthrough preserves unknown fields (Plex adds them silently),
// safeParse drops malformed items with a warning rather than throwing.

const plexStreamRawSchema = z
  .object({
    streamType: z.number().optional(),
    codec: z.string().optional(),
    displayTitle: z.string().optional(),
    bitrate: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    frameRate: z.union([z.number(), z.string()]).optional(),
    profile: z.string().optional(),
    level: z.number().optional(),
    bitDepth: z.number().optional(),
    chromaSubsampling: z.string().optional(),
    colorPrimaries: z.string().optional(),
    colorRange: z.string().optional(),
    colorSpace: z.string().optional(),
    scanType: z.string().optional(),
    channels: z.number().optional(),
    audioChannelLayout: z.string().optional(),
    samplingRate: z.number().optional(),
    language: z.string().optional(),
    languageCode: z.string().optional(),
  })
  .passthrough();

const plexPartRawSchema = z
  .object({
    // The streamable URL for this part (`/library/parts/<id>/<ts>/file.ext`).
    // Distinct from `file`, which is the path on the server's own filesystem
    // and is not fetchable over the API.
    key: z.string().optional(),
    file: z.string().optional(),
    size: z.number().optional(),
    container: z.string().optional(),
    duration: z.number().optional(),
    decision: z.string().optional(),
    audioProfile: z.string().optional(),
    Stream: z.array(plexStreamRawSchema).optional(),
  })
  .passthrough();

const plexMediaRawSchema = z
  .object({
    videoResolution: z.string().optional(),
    videoCodec: z.string().optional(),
    videoFrameRate: z.string().optional(),
    videoProfile: z.string().optional(),
    audioCodec: z.string().optional(),
    audioChannels: z.number().optional(),
    container: z.string().optional(),
    bitrate: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    optimizedForStreaming: z.union([z.boolean(), z.number(), z.string()]).optional(),
    Part: z.array(plexPartRawSchema).optional(),
  })
  .passthrough();

const plexPlayerRawSchema = z
  .object({
    title: z.string().optional(),
    machineIdentifier: z.string().optional(),
    product: z.string().optional(),
    platform: z.string().optional(),
    state: z.string().optional(),
    local: z.union([z.boolean(), z.number(), z.string()]).optional(),
    relayed: z.union([z.boolean(), z.number(), z.string()]).optional(),
    secure: z.union([z.boolean(), z.number(), z.string()]).optional(),
    address: z.string().optional(),
  })
  .passthrough();

const plexUserRawSchema = z
  .object({
    // Plex serialises this as a string in XML-derived JSON; the playback
    // history keys on it numerically, so coerce once here rather than at
    // every call site.
    id: z.coerce.number().optional(),
    title: z.string().optional(),
    thumb: z.string().optional(),
  })
  .passthrough();

const plexSessionRawSchema = z
  .object({
    /** The handle `/status/sessions/terminate` keys on. */
    id: z.string().optional(),
    location: z.string().optional(),
    bandwidth: z.number().optional(),
  })
  .passthrough();

const plexTranscodeSessionRawSchema = z
  .object({
    videoDecision: z.string().optional(),
    audioDecision: z.string().optional(),
    speed: z.number().optional(),
    progress: z.number().optional(),
    transcodeHwEncoding: z.union([z.boolean(), z.number(), z.string()]).optional(),
    sourceVideoCodec: z.string().optional(),
    sourceAudioCodec: z.string().optional(),
  })
  .passthrough();

const plexLabelRawSchema = z.object({ tag: z.string() }).passthrough();
const plexGuidRawSchema = z.object({ id: z.string() }).passthrough();
const plexGenreRawSchema = z.object({ tag: z.string() }).passthrough();
const plexCollectionRefRawSchema = z.object({ id: z.coerce.number().optional(), tag: z.string() }).passthrough();

export const plexMetadataRawSchema = z
  .object({
    ratingKey: z.string().optional(),
    /**
     * Present only on `/status/sessions`. Identifies a live session for as long
     * as it is open — Plex reuses the value across later, unrelated plays, so
     * it identifies a session but never a play.
     */
    sessionKey: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    /** The agent's own id — `plex://show/…`, or `com.plexapp.agents.…` on a legacy agent. */
    guid: z.string().optional(),
    /** A show's own episode ordering; absent when it follows the library's. */
    showOrdering: z.string().optional(),
    year: z.number().optional(),
    thumb: z.string().optional(),
    art: z.string().optional(),
    parentThumb: z.string().optional(),
    grandparentThumb: z.string().optional(),
    grandparentArt: z.string().optional(),
    librarySectionID: z.coerce.number().optional(),
    librarySectionTitle: z.string().optional(),
    grandparentTitle: z.string().optional(),
    grandparentRatingKey: z.string().optional(),
    parentRatingKey: z.string().optional(),
    parentTitle: z.string().optional(),
    parentIndex: z.number().optional(),
    index: z.number().optional(),
    addedAt: z.number().optional(),
    summary: z.string().optional(),
    contentRating: z.string().optional(),
    duration: z.number().optional(),
    originallyAvailableAt: z.string().optional(),
    status: z.string().optional(), // TV show airing status: "Continuing", "Ended", etc.
    studio: z.string().optional(),
    editionTitle: z.string().optional(),
    rating: z.number().optional(),
    audienceRating: z.number().optional(),
    viewOffset: z.number().optional(),
    viewCount: z.number().optional(),
    viewedAt: z.number().optional(),
    accountID: z.number().optional(),
    leafCount: z.number().optional(),
    Media: z.array(plexMediaRawSchema).optional(),
    Player: plexPlayerRawSchema.optional(),
    User: plexUserRawSchema.optional(),
    Session: plexSessionRawSchema.optional(),
    TranscodeSession: plexTranscodeSessionRawSchema.optional(),
    Label: z.array(plexLabelRawSchema).optional(),
    Guid: z.array(plexGuidRawSchema).optional(),
    Genre: z.array(plexGenreRawSchema).optional(),
    Director: z.array(plexGenreRawSchema).optional(),
    Collection: z.array(plexCollectionRefRawSchema).optional(),
  })
  .passthrough();

export type PlexMetadataRaw = z.infer<typeof plexMetadataRawSchema>;

export const plexHubRawSchema = z
  .object({
    key: z.string().optional(),
    hubKey: z.string().optional(),
    hubIdentifier: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    context: z.string().optional(),
    size: z.number().optional(),
    Metadata: z.array(plexMetadataRawSchema).optional(),
  })
  .passthrough();

export const plexSharedServerRawSchema = z
  .object({
    id: z.number().optional(),
    userID: z.number().optional(),
    filterMovies: z.string().optional(),
    filterTelevision: z.string().optional(),
    librarySectionIDs: z.string().optional(),
  })
  .passthrough();

/**
 * plex.tv user payloads. Everything is optional and coerced: `/api/users/` is
 * XML, so every attribute arrives as a string, while `/api/v2/home/users` is
 * JSON with real numbers and booleans for the same fields.
 */
const plexBool = z.union([z.boolean(), z.number(), z.string()]).optional();

export const plexUserRecordRawSchema = z
  .object({
    id: z.coerce.number().optional(),
    username: z.string().optional(),
    title: z.string().optional(),
    friendlyName: z.string().optional(),
    email: z.string().optional(),
    thumb: z.string().optional(),
    home: plexBool,
    admin: plexBool,
    guest: plexBool,
    restricted: plexBool,
    protected: plexBool,
  })
  .passthrough();

export const plexSharedServerFullRawSchema = z
  .object({
    id: z.coerce.number().optional(),
    userID: z.coerce.number().optional(),
    username: z.string().optional(),
    email: z.string().optional(),
    accepted: plexBool,
    allowSync: plexBool,
    allowTuners: plexBool,
    allowChannels: plexBool,
    allowCameraUpload: plexBool,
    filterMovies: z.string().optional(),
    filterTelevision: z.string().optional(),
    filterMusic: z.string().optional(),
  })
  .passthrough();

export const plexInviteRawSchema = z
  .object({
    id: z.coerce.number().optional(),
    username: z.string().optional(),
    title: z.string().optional(),
    email: z.string().optional(),
    thumb: z.string().optional(),
    createdAt: z.coerce.number().optional(),
  })
  .passthrough();

export function parseMetadataArray(raw: unknown): PlexMetadataRaw[] {
  if (!Array.isArray(raw)) return [];
  const out: PlexMetadataRaw[] = [];
  for (const item of raw) {
    const parsed = plexMetadataRawSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else console.warn("[plex] dropping malformed metadata item:", parsed.error.message);
  }
  return out;
}
