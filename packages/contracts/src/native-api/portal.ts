/**
 * Output schemas for the portal procedures the native app calls.
 *
 * Generated once from the routers' inferred output types and then owned by
 * hand: each is attached to its procedure with `.output()`, so the server
 * validates what it sends and tRPC types the resolver against it — a resolver
 * that drifts from its schema is a typecheck error, not a native decode
 * failure. `native-codegen` turns these into the Swift and Kotlin models.
 *
 * Rules for anything in here (`native-api.test.ts` and codegen enforce them):
 * JSON-representable only — no `z.date()`, bigint, transforms or custom
 * types; timestamps are epoch milliseconds. `int()` marks an integer for the
 * native models without validating it, so a wrong guess fails one app decode
 * rather than the endpoint.
 */
import { z } from "zod";
import { int } from "./int.ts";
import { MatchFilters, MatchRoomSummary, SignedIn } from "./shared.ts";

/** `auth.server` */
export const AuthServerOutput = z.object({
  product: z.enum(["rube-admin", "rube-portal"]),
  version: z.string(),
  capabilities: z.array(z.literal("exchange")),
});

/** `auth.exchange` */
export const AuthExchangeOutput = SignedIn;

/** `auth.logout` */
export const AuthLogoutOutput = z.object({ ok: z.boolean() });

/** `branding` */
export const BrandingOutput = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
  backgroundImage: z.string().optional(),
});

/** `personalizationStatus` */
export const PersonalizationStatusOutput = z.enum(["disabled", "disabling", "enabled", "enabling"]);

/** `me` */
export const MeOutput = z.object({ userId: int(), username: z.string() });

/** `components` */
export const ComponentsOutput = z.object({
  "action.keep": z.boolean(),
  "action.notForMe": z.boolean(),
  "tab.collections": z.boolean(),
  "tab.leaving": z.boolean(),
  "tab.match": z.boolean(),
  "tab.tastes": z.boolean(),
  "tastes.digest": z.boolean(),
  "tastes.genres": z.boolean(),
  "tastes.moods": z.boolean(),
  "tastes.neverRecommend": z.boolean(),
  "tastes.ratingFloor": z.boolean(),
  "tastes.rowCount": z.boolean(),
  "tastes.strictHate": z.boolean(),
  "tastes.watchedBias": z.boolean(),
});

/** `preferences.get` */
export const PreferencesGetOutput = z.object({
  userId: int(),
  optedIn: z.boolean(),
  preferences: z.object({
    genres: z.object({ loved: z.array(z.string()), liked: z.array(z.string()), hated: z.array(z.string()) }),
    people: z.object({
      lovedActors: z.array(z.string()),
      lovedDirectors: z.array(z.string()),
      avoided: z.array(z.string()),
    }),
    eras: z.object({ lovedDecades: z.array(z.number()), avoidBefore: z.number().optional() }),
    ratingFloor: z.number().optional(),
    contentRatingCeiling: z.string().optional(),
    runtime: z.object({ preferShorter: z.boolean().optional(), maxMinutes: z.number().optional() }).optional(),
    languages: z.object({ preferred: z.array(z.string()), includeForeign: z.boolean() }).optional(),
    watchedBias: z.enum(["balanced", "include_favorites", "new_to_me"]),
    moods: z.array(z.string()),
    vibe: z.enum(["mixed", "playful", "serious"]).optional(),
    excludedTitles: z.array(z.string()),
    excludedCollections: z.array(z.string()),
    rowCount: int().optional(),
    strictHate: z.boolean(),
    digest: z.object({ frequency: z.enum(["monthly", "never", "weekly"]), email: z.string() }),
  }),
  updatedAt: int().nullable(),
});

/** `preferences.set` */
export const PreferencesSetOutput = z.object({ ok: z.boolean() });

/** `myCollections` */
export const MyCollectionsOutput = z.array(
  z.object({ ratingKey: z.string(), title: z.string(), summary: z.string(), itemCount: int() }),
);

/** `notInterested` */
export const NotInterestedOutput = z.object({ ok: z.literal(true), excluded: int() });

/** `leavingSoon` */
export const LeavingSoonOutput = z.array(
  z.object({ ratingKey: z.string(), title: z.string(), runsRemaining: int(), voted: z.boolean() }),
);

/** `voteKeep` */
export const VoteKeepOutput = z.object({ ok: z.literal(true) });

/** `myWatchSummary` */
export const MyWatchSummaryOutput = z.object({ plays: int(), watchedMs: z.number() });

/** `searchTitles` */
export const SearchTitlesOutput = z.array(z.string());

/** `availableGenres` */
export const AvailableGenresOutput = z.array(z.string());

/** `match.libraries` */
export const MatchLibrariesOutput = z.array(z.object({ key: z.string(), title: z.string(), count: int() }));

/** `match.genres` */
export const MatchGenresOutput = z.array(z.string());

/** `match.presets` */
export const MatchPresetsOutput = z.array(z.object({ label: z.string(), filters: MatchFilters, count: int() }));

/** `match.count` */
export const MatchCountOutput = z.number();

/** `match.create` */
export const MatchCreateOutput = z.object({ code: z.string(), invite: z.string() });

/** `match.rooms` */
export const MatchRoomsOutput = z.array(MatchRoomSummary);

/** `match.join` */
export const MatchJoinOutput = z.object({ code: z.string() });

/** `match.state` */
export const MatchStateOutput = z.object({
  code: z.string(),
  invite: z.string(),
  library: z.string(),
  filters: MatchFilters,
  deckSize: int(),
  me: z.object({ swiped: int(), liked: int(), name: z.string(), guest: z.boolean() }),
  members: z.array(
    z.object({
      swiped: int(),
      liked: int(),
      id: int(),
      name: z.string(),
      thumb: z.string().nullable(),
      guest: z.boolean(),
      me: z.boolean(),
      online: z.boolean(),
    }),
  ),
  matches: z.array(
    z.object({
      ratingKey: z.string(),
      title: z.string(),
      year: int().nullable(),
      poster: z.string().nullable(),
      rating: z.number().nullable(),
      contentRating: z.string().nullable(),
      durationMs: z.number().nullable(),
      genres: z.array(z.string()),
      likedBy: z.array(z.string()),
      unanimous: z.boolean(),
      lastLikedAt: int(),
    }),
  ),
  unanimousCount: int(),
  swipedCount: int(),
  votes: z.array(z.object({ ratingKey: z.string(), voters: z.array(z.string()) })),
  myVote: z.string().nullable(),
  link: z.string(),
  plexServerId: z.string().nullable(),
});

/** `match.deck` */
export const MatchDeckOutput = z.object({
  remaining: int(),
  films: z.array(
    z.object({
      ratingKey: z.string(),
      title: z.string(),
      year: int().nullable(),
      poster: z.string().nullable(),
      rating: z.number().nullable(),
      contentRating: z.string().nullable(),
      durationMs: z.number().nullable(),
      genres: z.array(z.string()),
      summary: z.string(),
    }),
  ),
});

/** `match.swipe` */
export const MatchSwipeOutput = z.object({ matched: z.boolean() });

// match.undo: no output (void)

// match.reset: no output (void)

// match.vote: no output (void)

// match.leave: no output (void)

/** `match.guest.preview` */
export const MatchGuestPreviewOutput = MatchRoomSummary;

/** `match.guest.join` */
export const MatchGuestJoinOutput = z.object({ token: z.string() });
