/**
 * Per-user personalization preferences: the high-level taste signals a Plex
 * user sets to shape their own home-screen recommendations. Stored as a JSON
 * blob in `user_preferences` (keyed by Plex user id) and validated here.
 *
 * Used by:
 *   - BYW, WTYL, Pick It Back Up and personalisable rule runs (to filter/steer per-user generation),
 *   - the preferences tRPC router (to validate writes from the portal).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { token } from "@tinkerbell/container";
import { userPreferences, plexUsers, type Db } from "@tinkerbell/db";

export const userPreferencesSchema = z.object({
  genres: z
    .object({
      loved: z.array(z.string()).default([]),
      liked: z.array(z.string()).default([]),
      hated: z.array(z.string()).default([]),
    })
    .default({ loved: [], liked: [], hated: [] }),
  people: z
    .object({
      lovedActors: z.array(z.string()).default([]),
      lovedDirectors: z.array(z.string()).default([]),
      avoided: z.array(z.string()).default([]),
    })
    .default({ lovedActors: [], lovedDirectors: [], avoided: [] }),
  eras: z
    .object({
      lovedDecades: z.array(z.number().int()).default([]),
      avoidBefore: z.number().int().optional(),
    })
    .default({ lovedDecades: [] }),
  ratingFloor: z.number().min(0).max(10).optional(),
  contentRatingCeiling: z.string().optional(),
  runtime: z
    .object({
      preferShorter: z.boolean().optional(),
      maxMinutes: z.number().int().positive().optional(),
    })
    .optional(),
  languages: z
    .object({
      preferred: z.array(z.string()).default([]),
      includeForeign: z.boolean().default(true),
    })
    .optional(),
  watchedBias: z.enum(["new_to_me", "include_favorites", "balanced"]).default("balanced"),
  moods: z.array(z.string()).default([]),
  vibe: z.enum(["playful", "serious", "mixed"]).optional(),
  /** Titles this user never wants recommended — matched against *item* titles. */
  excludedTitles: z.array(z.string()).default([]),
  /**
   * Rows this user has said aren't for them, by collection name.
   *
   * Separate from `excludedTitles` because they are matched against different
   * things, and conflating them made the portal's "Not for me" button a no-op:
   * it wrote the *collection's* title into the item-title list, where every
   * consumer compared it against film titles and nothing ever matched. The row
   * was rebuilt identically on the next run, and the phantom entry turned up in
   * the user's "Never recommend" list.
   */
  excludedCollections: z.array(z.string()).default([]),
  rowCount: z.number().int().min(1).max(20).optional(),
  /** When true (default), hated genres are a hard exclude; otherwise a down-weight. */
  strictHate: z.boolean().default(true),
  /**
   * The user's own digest subscription, and the only thing that authorises
   * Tinkerbell to email them.
   *
   * Deliberately separate from the `optedIn` column beside this blob: that one
   * is consent to personalised *home screens*, and reusing it would mean
   * enabling one silently enabled the other. Someone can want a weekly email
   * and no reshuffled home, or the reverse.
   *
   * `frequency: "never"` is the default, and `email` is only ever set by the
   * user typing it into the portal — never harvested from plex.tv. A digest
   * with no address goes nowhere, which is the intended failure mode.
   */
  digest: z
    .object({
      frequency: z.enum(["never", "weekly", "monthly"]).default("never"),
      email: z.email().or(z.literal("")).default(""),
    })
    .default({ frequency: "never", email: "" }),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export function defaultUserPreferences(): UserPreferences {
  return userPreferencesSchema.parse({});
}

/** Parse a stored blob, falling back to defaults if it's missing/invalid. */
function parsePreferences(raw: unknown): UserPreferences {
  const result = userPreferencesSchema.safeParse(raw ?? {});
  return result.success ? result.data : defaultUserPreferences();
}

export interface UserPreferencesRecord {
  userId: number;
  optedIn: boolean;
  preferences: UserPreferences;
  updatedAt: number | null;
}

export interface DigestSubscriber {
  userId: number;
  username: string;
  email: string;
  frequency: "weekly" | "monthly";
  preferences: UserPreferences;
}

/**
 * A natural-language block describing a user's tastes, injected into LLM
 * prompts (BYW, ai_prompt) so the model steers toward loved/liked content
 * and away from disliked. Returns "" when the user has expressed nothing.
 */
export function preferencesPromptBlock(prefs: UserPreferences): string {
  const lines: string[] = [];
  const { genres, people, eras, moods } = prefs;

  if (genres.loved.length) lines.push(`- Strongly favour these genres: ${genres.loved.join(", ")}.`);
  if (genres.liked.length) lines.push(`- Lean towards these genres: ${genres.liked.join(", ")}.`);
  if (genres.hated.length) {
    lines.push(
      prefs.strictHate
        ? `- Never include these genres: ${genres.hated.join(", ")}.`
        : `- Avoid these genres where possible: ${genres.hated.join(", ")}.`,
    );
  }
  if (people.lovedActors.length) lines.push(`- The viewer loves these actors: ${people.lovedActors.join(", ")}.`);
  if (people.lovedDirectors.length)
    lines.push(`- The viewer loves these directors: ${people.lovedDirectors.join(", ")}.`);
  if (people.avoided.length) lines.push(`- Avoid work by: ${people.avoided.join(", ")}.`);
  if (eras.lovedDecades.length) lines.push(`- Prefer films from: ${eras.lovedDecades.map((d) => `${d}s`).join(", ")}.`);
  if (eras.avoidBefore) lines.push(`- Avoid anything released before ${eras.avoidBefore}.`);
  if (prefs.ratingFloor) lines.push(`- Prefer well-rated titles (around ${prefs.ratingFloor}+ out of 10).`);
  if (prefs.contentRatingCeiling) lines.push(`- Keep content rated no higher than ${prefs.contentRatingCeiling}.`);
  if (moods.length) lines.push(`- Match these moods: ${moods.join(", ")}.`);
  if (prefs.watchedBias === "new_to_me") lines.push(`- Favour titles the viewer probably hasn't seen.`);
  if (prefs.excludedTitles.length) lines.push(`- Never include: ${prefs.excludedTitles.join(", ")}.`);

  if (lines.length === 0) return "";
  return `\nThis collection is for a specific viewer. Honour their tastes:\n${lines.join("\n")}\n`;
}

export interface PreferencesDeps {
  db: Db;
}

export function createPreferences(deps: PreferencesDeps) {
  const { db } = deps;

  function getUserPreferences(userId: number): UserPreferencesRecord {
    const row = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
    if (!row) {
      return { userId, optedIn: false, preferences: defaultUserPreferences(), updatedAt: null };
    }
    return {
      userId,
      optedIn: row.optedIn === 1,
      preferences: parsePreferences(row.preferences),
      updatedAt: row.updatedAt,
    };
  }

  function setUserPreferences(userId: number, preferences: UserPreferences, optedIn: boolean): void {
    const now = Date.now();
    const value = userPreferencesSchema.parse(preferences);
    db.insert(userPreferences)
      .values({ userId, preferences: value, optedIn: optedIn ? 1 : 0, updatedAt: now })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { preferences: value, optedIn: optedIn ? 1 : 0, updatedAt: now },
      })
      .run();
  }

  /** Resolve an opted-in user's preferences by Plex username (for BYW/personalize). */
  function getOptedInPreferencesByUsername(username: string): UserPreferences | undefined {
    const row = db
      .select({ preferences: userPreferences.preferences })
      .from(userPreferences)
      .innerJoin(plexUsers, eq(plexUsers.userId, userPreferences.userId))
      .where(and(eq(plexUsers.username, username), eq(userPreferences.optedIn, 1)))
      .get();
    if (!row) return undefined;
    return parsePreferences(row.preferences);
  }

  /** All opted-in users with their resolved username (for the personalize pass). */
  function listOptedInUserPreferences(): Array<{
    userId: number;
    username: string;
    preferences: UserPreferences;
  }> {
    return db
      .select({
        userId: userPreferences.userId,
        username: plexUsers.username,
        preferences: userPreferences.preferences,
      })
      .from(userPreferences)
      .innerJoin(plexUsers, eq(plexUsers.userId, userPreferences.userId))
      .where(eq(userPreferences.optedIn, 1))
      .all()
      .map((r) => ({ userId: r.userId, username: r.username, preferences: parsePreferences(r.preferences) }));
  }

  /**
   * Everyone who has asked for a digest and given somewhere to send it.
   *
   * Both halves are required, and neither is inferable: a frequency without an
   * address has nowhere to go, and an address without a frequency was typed by
   * someone who then chose "never". Users who have never opened the portal have
   * no row here at all, which is the correct answer — Tinkerbell has no address
   * for them and must not go looking for one.
   */
  function listDigestSubscribers(): DigestSubscriber[] {
    return db
      .select({
        userId: userPreferences.userId,
        username: plexUsers.username,
        preferences: userPreferences.preferences,
      })
      .from(userPreferences)
      .innerJoin(plexUsers, eq(plexUsers.userId, userPreferences.userId))
      .all()
      .flatMap((row) => {
        const preferences = parsePreferences(row.preferences);
        const { frequency, email } = preferences.digest;
        if (frequency === "never" || email === "") return [];
        return [{ userId: row.userId, username: row.username, email, frequency, preferences }];
      });
  }

  return {
    getUserPreferences,
    setUserPreferences,
    getOptedInPreferencesByUsername,
    listOptedInUserPreferences,
    listDigestSubscribers,
  };
}

export type Preferences = ReturnType<typeof createPreferences>;

export const PreferencesToken = token<Preferences>("preferences");
