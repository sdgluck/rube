/**
 * Finish the Franchise: one collection per person per movie library, of the
 * next film in each series they've started.
 *
 * Someone who watched Alien and Aliens has Alien 3 sitting in the library and
 * nothing on Home saying so — Plex's own collections show the whole series,
 * not where this person is in it. Like Pick It Back Up, which does this for
 * shows, it asks no model: what someone has finished is a fact in the
 * playback ledger, and the order of a series is a fact on TMDb.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **Next after the furthest one seen**, not the first one unseen. Someone
 *    who skipped from Alien to Alien 3 is past Aliens.
 *  - **A gap stops the series.** When the next part isn't in the library the
 *    row offers nothing for that series, rather than recommending part four
 *    to someone who hasn't seen part three (`skipMissing` turns this off).
 *  - **Franchise membership is cached**, on the shared TMDb details row
 *    (`collectionId`), so a run costs one details fetch per newly watched
 *    film and one collection fetch per series in play — never a library walk.
 *  - **Watched means `watch_state`**, which is never pruned and folds in
 *    imported Plex history, so playback retention can't make someone's
 *    progress through a series vanish.
 */
import { FRANCHISE_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { DAY_MS, displayTitle, errorMessage } from "@tinkerbell/core";
import type { FranchiseJobConfig, JobContext } from "@tinkerbell/core";
import { mediaItems } from "@tinkerbell/db";
import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { ClockToken } from "@tinkerbell/ports";
import { fetchCollection, type TmdbCollection, type TmdbConfig } from "@tinkerbell/tmdb";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { createTmdbMetadataCommand } from "../generate/tmdb-metadata.ts";
import { historyUserIds } from "../we-think-youd-like/profile.ts";
import {
  createPersonalRowWriter,
  noUsersError,
  ownRow,
  targetUsers,
  type PersonalRow,
} from "../../personalize/personal-row-writer.ts";
import { franchiseSummary, nextPart, watchedFilms, type WatchedFilm } from "./next-part.ts";

export const FRANCHISE_LABEL = "FinishTheFranchise";
export const FRANCHISE_ROW_NAME = "Finish the Franchise";

interface SectionState {
  section: PlexSection;
  rows: PersonalRow[];
}

export function createFinishTheFranchiseCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences">,
  opts: { now?: () => number; tmdbBaseUrl?: string } = {},
) {
  const { clients, collections, config, db, preferences } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { hydrateTmdbDetails } = createTmdbMetadataCommand(deps);

  /** Every film in these libraries with a TMDb id: where each copy is, by TMDb id. */
  function libraryByTmdb(
    sectionIds: string[],
  ): Map<number, Array<{ sectionId: string; ratingKey: string; title: string }>> {
    const out = new Map<number, Array<{ sectionId: string; ratingKey: string; title: string }>>();
    for (const row of db
      .select({
        tmdbId: mediaItems.tmdbId,
        sectionId: mediaItems.sectionId,
        ratingKey: mediaItems.ratingKey,
        title: mediaItems.title,
      })
      .from(mediaItems)
      .where(and(inArray(mediaItems.sectionId, sectionIds), eq(mediaItems.type, "movie"), isNotNull(mediaItems.tmdbId)))
      // One copy per library, chosen the same way every run.
      .orderBy(asc(mediaItems.ratingKey))
      .all()) {
      const copies = out.get(row.tmdbId!) ?? [];
      if (!copies.some((c) => c.sectionId === row.sectionId)) copies.push(row);
      out.set(row.tmdbId!, copies);
    }
    return out;
  }

  async function run(ctx: JobContext, cfg: FranchiseJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const maxIdleDays = cfg.maxIdleDays ?? FRANCHISE_DEFAULTS.maxIdleDays;
    const minWatched = cfg.minWatched ?? FRANCHISE_DEFAULTS.minWatched;
    const maxItems = cfg.maxItems ?? FRANCHISE_DEFAULTS.maxItems;
    const pin = cfg.pinToHomepage ?? FRANCHISE_DEFAULTS.pinToHomepage;
    const skipMissing = cfg.skipMissing ?? FRANCHISE_DEFAULTS.skipMissing;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    const apiKey = getConfig("global_tmdb_api_key");
    if (!apiKey)
      throw new Error("TMDb API key is required to know which series a film is in. Configure it in Settings.");
    const tmdb: TmdbConfig = { apiKey, baseUrl: opts.tmdbBaseUrl };
    const users = targetUsers(db, allowlist);
    if (users.length === 0) throw noUsersError(allowlist);

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell finish-the-franchise`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    const writer = createPersonalRowWriter({
      client,
      ctx,
      machineId,
      label: FRANCHISE_LABEL,
      rowName: FRANCHISE_ROW_NAME,
      collections,
    });

    // Film libraries only: a TMDb collection is a series of films.
    const sections = new Map<string, SectionState>();
    for (const section of await resolveTargetSections(client, getConfig, cfg.sections)) {
      if (section.type !== "movie") continue;
      const rows = await writer.listRows(section.key);
      sections.set(section.key, { section, rows });
      ctx.log(`"${section.title}": ${rows.length} existing row(s).`);
    }
    if (sections.size === 0) {
      ctx.log("No film library to build in.");
      return;
    }
    const library = libraryByTmdb([...sections.keys()]);

    // Everyone's history first, so every film anyone has played is hydrated
    // in one batch — rows cached before `collectionId` existed are refetched.
    const watchedBy = new Map(users.map((u) => [u.username, watchedFilms(db, historyUserIds(u))]));
    const played = new Set<number>();
    for (const films of watchedBy.values()) for (const id of films.keys()) played.add(id);
    const details = await hydrateTmdbDetails(
      ctx,
      tmdb,
      [...played].map((tmdbId) => ({ tmdbId, mediaType: "movie" as const })),
      { stale: (d) => d.collectionId === undefined },
    );
    const seriesOf = (tmdbId: number) => details.get(`movie:${tmdbId}`)?.collectionId ?? null;

    // One fetch per series, however many people are partway through it.
    const fetched = new Map<number, Promise<TmdbCollection | null>>();
    const collectionOf = (id: number) => {
      let pending = fetched.get(id);
      if (!pending) {
        pending = fetchCollection(tmdb, id).catch((err) => {
          if (ctx.signal.aborted) throw err;
          ctx.log(`Couldn't read TMDb collection ${id}: ${errorMessage(err)}; leaving it out.`);
          return null;
        });
        fetched.set(id, pending);
      }
      return pending;
    };

    const today = now();
    const idleSince = today - maxIdleDays * DAY_MS;
    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === FRANCHISE_ROW_NAME.toLowerCase(),
      );
      if (declined) {
        for (const state of sections.values()) {
          const existing = ownRow(state.rows, FRANCHISE_LABEL, user.username);
          if (existing) await writer.deleteRow(existing.ratingKey, `${user.name} said it wasn't for them`);
        }
        continue;
      }
      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));

      // The series they're in, most recently touched first.
      const watched = watchedBy.get(user.username) ?? new Map<number, WatchedFilm>();
      const series = new Map<number, { finished: number; lastPlayedAt: number }>();
      for (const film of watched.values()) {
        const id = seriesOf(film.tmdbId);
        if (id == null) continue;
        const s = series.get(id) ?? { finished: 0, lastPlayedAt: 0 };
        if (film.finished) s.finished++;
        s.lastPlayedAt = Math.max(s.lastPlayedAt, film.lastPlayedAt);
        series.set(id, s);
      }
      const inPlay = [...series]
        .filter(([, s]) => s.finished >= minWatched && s.lastPlayedAt >= idleSince)
        .sort((a, b) => b[1].lastPlayedAt - a[1].lastPlayedAt);

      const picks = new Map<string, Array<{ ratingKey: string; title: string }>>();
      const notes: string[] = [];
      for (const [id] of inPlay) {
        const collection = await collectionOf(id);
        if (!collection) continue;
        const inLibrary = new Set(collection.parts.map((p) => p.id).filter((pid) => library.has(pid)));
        const next = nextPart(collection.parts, watched, inLibrary, today, { skipMissing });
        if (!next) continue;
        if ("missing" in next) {
          notes.push(`${collection.name}: next is ${next.missing.title}, which isn't in the library`);
          continue;
        }
        notes.push(`${collection.name}: ${next.resume ? "resume" : "next"} ${next.part.title}`);
        for (const copy of library.get(next.part.id) ?? []) {
          if (excluded.has(copy.title.toLowerCase())) continue;
          const bucket = picks.get(copy.sectionId) ?? [];
          if (bucket.length < maxItems) bucket.push({ ratingKey: copy.ratingKey, title: copy.title });
          picks.set(copy.sectionId, bucket);
        }
      }
      if (notes.length > 0) ctx.log(`${user.name}: ${notes.join("; ")}.`);

      for (const state of sections.values()) {
        const mine = picks.get(state.section.key) ?? [];
        const existing = ownRow(state.rows, FRANCHISE_LABEL, user.username);
        if (mine.length === 0) {
          if (existing) await writer.deleteRow(existing.ratingKey, "nothing left in it");
          continue;
        }
        await writer.writeRow(
          state.section,
          state.rows,
          user,
          mine.map((p) => p.ratingKey),
          franchiseSummary(mine.map((p) => p.title)),
          pin,
        );
      }
    }

    // Rows for people no longer on the Users page; not with an allowlist set.
    if (allowlist.length === 0)
      await writer.sweepOrphans(
        [...sections.values()].map((s) => s.rows),
        users,
      );
    ctx.progress(users.length, users.length, "Done");
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: FranchiseJobConfig): Promise<void> {
  return createFinishTheFranchiseCommand(ctx.scope.resolve(ServicesToken), {
    now: ctx.scope.resolve(ClockToken),
  }).run(ctx, config);
}
