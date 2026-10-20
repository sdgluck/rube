/**
 * More From…: per person, a row or two of "More from Denis Villeneuve" — the
 * films by the directors and lead actors they keep finishing, that they
 * haven't seen and the library has.
 *
 * Because You Watched answers "more like that film"; this answers "more by
 * that person", which is how a lot of people actually choose — and it needs
 * no model, because who made a film is a fact on TMDb.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **Leads only.** Directors, and actors billed in the top three. Counting
 *    every credited actor would make the most prolific character actor in
 *    the library everyone's favourite.
 *  - **Only someone with something left.** A person whose films they've all
 *    seen gets no row; the next name down does.
 *  - **One fetch per person per run**, however many people share a
 *    favourite; the details of watched films come from the shared TMDb cache.
 *  - **Rows are keyed by person** (`Person:<id>`), so when someone's top names
 *    change, the old row goes and the new one comes — and a row for a name
 *    still on top is edited in place.
 */
import { MORE_FROM_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { displayTitle, errorMessage } from "@tinkerbell/core";
import type { JobContext, MoreFromJobConfig } from "@tinkerbell/core";
import { mediaItems, type TmdbCachedDetails } from "@tinkerbell/db";
import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { ClockToken } from "@tinkerbell/ports";
import { fetchPersonCredits, type TmdbConfig } from "@tinkerbell/tmdb";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { createTmdbMetadataCommand } from "../generate/tmdb-metadata.ts";
import { watchedFilms } from "../finish-the-franchise/next-part.ts";
import { historyUserIds } from "../we-think-youd-like/profile.ts";
import {
  createPersonalRowWriter,
  hasLabel,
  noUsersError,
  targetUsers,
  type PersonalRow,
} from "../../personalize/personal-row-writer.ts";
import { moreFromSummary, personKey, scorePeople, type Person } from "./people.ts";

export const MORE_FROM_LABEL = "MoreFrom";
export const MORE_FROM_ROW_NAME = "More From…";
/** A row's name, as the person reads it — and as the portal's "Not for me" records it. */
const rowName = (person: Pick<Person, "name">) => `More from ${person.name}`;

/** How far down someone's list to look for names with something left to offer. */
const CANDIDATES = 10;

interface SectionState {
  section: PlexSection;
  rows: PersonalRow[];
}

export function createMoreFromCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences">,
  opts: { now?: () => number; tmdbBaseUrl?: string } = {},
) {
  const { clients, collections, config, db, preferences } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { hydrateTmdbDetails } = createTmdbMetadataCommand(deps);

  /** Every film in these libraries with a TMDb id: one copy per library, by TMDb id. */
  function libraryByTmdb(sectionIds: string[]) {
    const out = new Map<number, Array<{ sectionId: string; ratingKey: string; title: string; year: number | null }>>();
    for (const row of db
      .select({
        tmdbId: mediaItems.tmdbId,
        sectionId: mediaItems.sectionId,
        ratingKey: mediaItems.ratingKey,
        title: mediaItems.title,
        year: mediaItems.year,
      })
      .from(mediaItems)
      .where(and(inArray(mediaItems.sectionId, sectionIds), eq(mediaItems.type, "movie"), isNotNull(mediaItems.tmdbId)))
      .orderBy(asc(mediaItems.ratingKey))
      .all()) {
      const copies = out.get(row.tmdbId!) ?? [];
      if (!copies.some((c) => c.sectionId === row.sectionId)) copies.push(row);
      out.set(row.tmdbId!, copies);
    }
    return out;
  }

  async function run(ctx: JobContext, cfg: MoreFromJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const peopleWanted = cfg.people ?? MORE_FROM_DEFAULTS.people;
    const minSeen = cfg.minSeen ?? MORE_FROM_DEFAULTS.minSeen;
    const minItems = cfg.minItems ?? MORE_FROM_DEFAULTS.minItems;
    const maxItems = cfg.maxItems ?? MORE_FROM_DEFAULTS.maxItems;
    const pin = cfg.pinToHomepage ?? MORE_FROM_DEFAULTS.pinToHomepage;
    const includeActors = cfg.includeActors ?? MORE_FROM_DEFAULTS.includeActors;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    const apiKey = getConfig("global_tmdb_api_key");
    if (!apiKey) throw new Error("TMDb API key is required to know who made each film. Configure it in Settings.");
    const tmdb: TmdbConfig = { apiKey, baseUrl: opts.tmdbBaseUrl };
    const users = targetUsers(db, allowlist);
    if (users.length === 0) throw noUsersError(allowlist);

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell more-from`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    const writer = createPersonalRowWriter({
      client,
      ctx,
      machineId,
      label: MORE_FROM_LABEL,
      rowName: MORE_FROM_ROW_NAME,
      collections,
    });

    const sections = new Map<string, SectionState>();
    for (const section of await resolveTargetSections(client, getConfig, cfg.sections)) {
      if (section.type !== "movie") continue;
      sections.set(section.key, { section, rows: await writer.listRows(section.key) });
    }
    if (sections.size === 0) {
      ctx.log("No film library to build in.");
      return;
    }
    const library = libraryByTmdb([...sections.keys()]);

    // Everyone's finished films first, so their details are hydrated in one batch.
    const watchedBy = new Map(users.map((u) => [u.username, watchedFilms(db, historyUserIds(u))]));
    const finishedIds = new Set<number>();
    for (const films of watchedBy.values()) for (const f of films.values()) if (f.finished) finishedIds.add(f.tmdbId);
    const hydrated = await hydrateTmdbDetails(
      ctx,
      tmdb,
      [...finishedIds].map((tmdbId) => ({ tmdbId, mediaType: "movie" as const })),
    );
    const details = new Map<number, TmdbCachedDetails>();
    for (const id of finishedIds) {
      const d = hydrated.get(`movie:${id}`);
      if (d) details.set(id, d);
    }

    // One filmography fetch per person, however many people share them.
    const filmographies = new Map<string, Promise<number[] | null>>();
    const filmographyOf = (person: Person) => {
      const memo = `${person.role}:${person.id}`;
      let pending = filmographies.get(memo);
      if (!pending) {
        pending = fetchPersonCredits(
          tmdb,
          person.id,
          person.role === "director"
            ? { role: "crew", crewJob: "Director", mediaTypes: ["movie"] }
            : { role: "cast", mediaTypes: ["movie"] },
        )
          .then((credits) => credits.map((c) => c.id))
          .catch((err) => {
            if (ctx.signal.aborted) throw err;
            ctx.log(`Couldn't read ${person.name}'s films from TMDb: ${errorMessage(err)}; leaving them out.`);
            return null;
          });
        filmographies.set(memo, pending);
      }
      return pending;
    };

    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const mine = (state: SectionState) =>
        state.rows.filter((r) => hasLabel(r, MORE_FROM_LABEL) && r.labels.includes(`User:${user.username}`));
      // "Not for me" names one row — "More from Ryan Gosling" — so it drops
      // that name, and the next one down takes its place. The row itself goes
      // in the sweep below, as any name no longer chosen does.
      const declined = new Set((prefs?.excludedCollections ?? []).map((t) => displayTitle(t).toLowerCase()));
      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      const watched = watchedBy.get(user.username)!;
      const finished = [...watched.values()].filter((f) => f.finished);
      const candidates = scorePeople(finished, details, now(), { includeActors })
        .filter((p) => p.seen.size >= minSeen && !declined.has(rowName(p).toLowerCase()))
        .slice(0, CANDIDATES);

      // Their top names that still have films to offer, and what those are, per library.
      const chosen: Array<{
        person: Person;
        bySection: Map<string, Array<{ ratingKey: string; title: string; year: number | null }>>;
      }> = [];
      for (const person of candidates) {
        if (chosen.length >= peopleWanted) break;
        const films = await filmographyOf(person);
        if (!films) continue;
        const bySection = new Map<string, Array<{ ratingKey: string; title: string; year: number | null }>>();
        for (const id of new Set(films)) {
          if (watched.has(id)) continue;
          for (const copy of library.get(id) ?? []) {
            if (excluded.has(copy.title.toLowerCase())) continue;
            const list = bySection.get(copy.sectionId) ?? [];
            list.push(copy);
            bySection.set(copy.sectionId, list);
          }
        }
        if (![...bySection.values()].some((l) => l.length >= minItems)) continue;
        chosen.push({ person, bySection });
      }
      if (candidates.length > 0) {
        ctx.log(
          `${user.name}: ${chosen.length > 0 ? chosen.map((c) => `${c.person.name} (${c.person.seen.size} seen)`).join(", ") : "nobody with films left to offer"}.`,
        );
      }

      for (const state of sections.values()) {
        const wanted = new Set<string>();
        for (const { person, bySection } of chosen) {
          const films = (bySection.get(state.section.key) ?? [])
            .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
            .slice(0, maxItems);
          if (films.length < minItems) continue;
          const key = personKey(person.id);
          wanted.add(key);
          await writer.writeRow(
            state.section,
            state.rows,
            user,
            films.map((f) => f.ratingKey),
            moreFromSummary(person),
            pin,
            { key, rowName: rowName(person) },
          );
        }
        // Their rows for names no longer on top.
        for (const row of mine(state)) {
          const key = row.labels.find((l) => l.startsWith("Person:"));
          if (key && wanted.has(key)) continue;
          const why = declined.has(displayTitle(row.title).toLowerCase())
            ? `${user.name} said it wasn't for them`
            : "no longer one of their top names";
          await writer.deleteRow(row.ratingKey, why, displayTitle(row.title));
        }
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
export default function run(ctx: JobContext, config: MoreFromJobConfig): Promise<void> {
  return createMoreFromCommand(ctx.scope.resolve(ServicesToken), { now: ctx.scope.resolve(ClockToken) }).run(
    ctx,
    config,
  );
}
