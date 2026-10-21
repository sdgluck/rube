/* ─── Plex Watchlist → Radarr/Sonarr ────────────────────────────────────────
 *
 * Adding something to your watchlist in the Plex app is the most natural "I
 * want this" signal the platform has, and until now it did nothing. This is
 * the job that makes it do something: read the account's watchlist, work out
 * which entries are not in the library, and hand those to the *Arr that owns
 * them.
 *
 * Three things decide whether this is safe to run every fifteen minutes.
 *
 * **The ledger, not the list.** The watchlist keeps no record of having been
 * acted on — it answers the same way on the thousandth poll as on the first.
 * `watchlist_items` is what remembers, and it is why a failed add is retried
 * rather than repeated, and why an item removed and re-added is not requested
 * twice. See the table's own note for why rows outlive the entries.
 *
 * **Presence is asked of Plex, and availability is asked of the *Arr.** Those
 * are two different questions with two very different costs. "Is this already
 * in the library" needs the GUID index, which means paging every relevant
 * section — so it is built lazily, once per run, and only when there is at
 * least one entry that has never been acted on. Most runs find nothing new and
 * make no request to the server at all. "Has the thing I requested arrived
 * yet" is asked only when `removeOnAvailable` is on, and it is asked of Radarr
 * or Sonarr (`hasFile`) rather than of Plex, because the alternative — a
 * library walk every quarter of an hour for as long as a download is pending —
 * costs more than the feature is worth. This is a deliberate departure from
 * the plan, which routed both through the GUID index.
 *
 * **One cap for the run, not one per service.** `maxAddsPerRun` counts add
 * *attempts* across both *Arrs. Per-service caps do not compose, which is the
 * same lesson the cleanup ledger learned about per-rule ones: two limits of
 * thirty are a limit of sixty, and nobody setting a number here means that.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { token } from "@rube/container";
import {
  arrExternalId,
  createLogger,
  errorMessage,
  imdbId,
  tmdbId,
  tvdbId,
  type ArrInstances,
  type Clients,
  type ConfigStore,
  type JobContext,
  type WatchlistArrTarget,
} from "@rube/core";
import { watchlistItems, type Db } from "@rube/db";
import { fetchWatchlist, removeFromWatchlist, type WatchlistEntry } from "@rube/plex";
import type { EventBus } from "@rube/ports";

const log = createLogger("watchlist");

/** Rows the sync will still act on. Everything else is a settled outcome. */
const ACTIONABLE_STATUSES = ["new", "failed"] as const;

/** The default a fresh install gets, and what the Settings form starts from. */
export const DEFAULT_WATCHLIST_SYNC = {
  enabled: false,
  radarr: emptyTarget(),
  sonarr: emptyTarget(),
  removeOnAvailable: false,
  maxAddsPerRun: 20,
  dryRun: true,
} as const;

function emptyTarget(): WatchlistArrTarget {
  return { enabled: false, qualityProfileId: 0, rootFolderPath: "", monitor: true, searchOnAdd: true };
}

/** Which *Arr owns an entry. Plex says "show"; Sonarr is the one that cares. */
function serviceFor(type: string): "radarr" | "sonarr" {
  return type === "show" || type === "season" || type === "episode" ? "sonarr" : "radarr";
}

export interface WatchlistDeps {
  db: Db;
  config: ConfigStore;
  clients: Clients;
  arr: ArrInstances;
  emitEvent: EventBus;
}

export function createWatchlist(deps: WatchlistDeps) {
  const { db, config, clients, arr, emitEvent } = deps;
  const { getConfig } = config;
  const { resolveArrInstance } = arr;

  function settings() {
    return getConfig("watchlist_sync") ?? { ...DEFAULT_WATCHLIST_SYNC };
  }

  /** The activity table in Settings → Watchlist. Newest sighting first. */
  function listWatchlistItems(limit = 200) {
    return db.select().from(watchlistItems).orderBy(desc(watchlistItems.firstSeenAt)).limit(limit).all();
  }

  function watchlistCounts(): Record<string, number> {
    const rows = db
      .select({ status: watchlistItems.status, count: sql<number>`count(*)` })
      .from(watchlistItems)
      .groupBy(watchlistItems.status)
      .all();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  /**
   * Fold this run's sighting of the watchlist into the ledger.
   *
   * Updates rather than replaces: `firstSeenAt` and everything about what we
   * did are the row's own history, and only the facts that come from plex.tv
   * are refreshed. `externalId` is only ever *filled in* — an entry that
   * arrives without provider ids one run and with them the next should gain
   * them, but a row that already has one must not lose it to a flaky response.
   */
  function recordSighting(entries: WatchlistEntry[], now: number): void {
    for (const entry of entries) {
      const externalId = arrExternalId(entry, serviceFor(entry.type)) ?? "";
      const existing = db.select().from(watchlistItems).where(eq(watchlistItems.guid, entry.guid)).get();
      if (!existing) {
        db.insert(watchlistItems)
          .values({
            guid: entry.guid,
            ratingKey: entry.ratingKey,
            title: entry.title,
            type: entry.type,
            year: entry.year ?? null,
            externalId,
            addedAt: entry.addedAt ?? null,
            firstSeenAt: now,
            lastSeenAt: now,
            status: "new",
          })
          .run();
        continue;
      }
      db.update(watchlistItems)
        .set({
          ratingKey: entry.ratingKey || existing.ratingKey,
          title: entry.title || existing.title,
          type: entry.type || existing.type,
          year: entry.year ?? existing.year,
          externalId: existing.externalId || externalId,
          addedAt: entry.addedAt ?? existing.addedAt,
          lastSeenAt: now,
        })
        .where(eq(watchlistItems.guid, entry.guid))
        .run();
    }
  }

  /**
   * Provider ids of everything in the library, split by what kind of section
   * it came from.
   *
   * Split because ids are only unique within a provider *and* a media type —
   * TMDb 603 is The Matrix as a film and something else entirely as a series,
   * and a single flat set would report a watchlisted show as already present
   * because a film shares its number.
   */
  async function buildLibraryIndex(signal?: AbortSignal): Promise<{ movie: Set<string>; show: Set<string> }> {
    const client = clients.getPlexClient({ signal });
    const sections = await client.getSections();
    const index = { movie: new Set<string>(), show: new Set<string>() };

    for (const section of sections) {
      if (section.type !== "movie" && section.type !== "show") continue;
      const bucket = section.type === "movie" ? index.movie : index.show;
      for (const item of await client.allItemsWithGuids(section.key)) {
        const tmdb = tmdbId(item);
        if (tmdb != null) bucket.add(`tmdb:${tmdb}`);
        const imdb = imdbId(item);
        if (imdb) bucket.add(`imdb:${imdb}`);
        const tvdb = tvdbId(item);
        if (tvdb != null) bucket.add(`tvdb:${tvdb}`);
      }
    }
    return index;
  }

  /**
   * Is this entry already in the library?
   *
   * Every provider id the entry carries is checked, not just the one the *Arr
   * would be asked about. A film matched by IMDb in Plex and indexed by TMDb
   * in Radarr is the common case, and testing one id would re-request a film
   * that is sitting on disk.
   */
  function inLibrary(entry: WatchlistEntry, index: { movie: Set<string>; show: Set<string> }): boolean {
    const bucket = serviceFor(entry.type) === "sonarr" ? index.show : index.movie;
    const tmdb = tmdbId(entry);
    if (tmdb != null && bucket.has(`tmdb:${tmdb}`)) return true;
    const imdb = imdbId(entry);
    if (imdb && bucket.has(`imdb:${imdb}`)) return true;
    const tvdb = tvdbId(entry);
    if (tvdb != null && bucket.has(`tvdb:${tvdb}`)) return true;
    return false;
  }

  function mark(guid: string, patch: Partial<typeof watchlistItems.$inferInsert>): void {
    db.update(watchlistItems).set(patch).where(eq(watchlistItems.guid, guid)).run();
  }

  /**
   * Take an item off the user's own watchlist, if they asked for that.
   *
   * Failure here is logged and swallowed. The item is in the library, which is
   * the outcome that mattered; failing the run over a tidy-up would bury the
   * adds that succeeded, and the next run retries it anyway.
   */
  async function tidyUp(token: string, ratingKey: string, title: string, signal?: AbortSignal): Promise<boolean> {
    if (!ratingKey) return false;
    try {
      await removeFromWatchlist(token, ratingKey, { signal });
      return true;
    } catch (err) {
      log.warn("could not remove an item from the watchlist", { title, err: errorMessage(err) });
      return false;
    }
  }

  async function syncWatchlist(ctx: JobContext): Promise<string> {
    const cfg = settings();
    if (!cfg.enabled) return "Watchlist sync is switched off.";

    const plexToken = getConfig("global_plex_token");
    if (!plexToken) return "Plex is not configured.";

    let entries: WatchlistEntry[];
    try {
      entries = await fetchWatchlist(plexToken, { signal: ctx.signal, onHealth: clients.plexHealthCallback });
    } catch (err) {
      // Returned rather than thrown, like the Overseerr poller: plex.tv being
      // unreachable is not a fault of this job, and failing every run would
      // bury the one that matters.
      return `Could not reach plex.tv: ${errorMessage(err)}`;
    }

    const now = Date.now();
    recordSighting(entries, now);

    const onList = new Map(entries.map((e) => [e.guid, e]));
    const rows = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.lastSeenAt, now))
      .all()
      .filter((r) => onList.has(r.guid));

    const toAction = rows.filter((r) => (ACTIONABLE_STATUSES as readonly string[]).includes(r.status));
    const pendingArrival = cfg.removeOnAvailable ? rows.filter((r) => r.status === "requested") : [];
    // Already known to be in the library but still on the list: either the
    // setting was switched on after we found them, or last run's removal
    // failed. Free to retry — no lookup is needed to know the answer.
    const strays = cfg.removeOnAvailable ? rows.filter((r) => r.status === "present") : [];

    let added = 0;
    let present = 0;
    let failed = 0;
    let skipped = 0;
    let removed = 0;

    if (toAction.length > 0) {
      ctx.progress(0, toAction.length, "Checking the library");
      let index: { movie: Set<string>; show: Set<string> };
      try {
        index = await buildLibraryIndex(ctx.signal);
      } catch (err) {
        return `Could not read the Plex library: ${errorMessage(err)}`;
      }

      const { lookupByExternalId, addItem } = await import("@rube/arr");
      let attempts = 0;
      let capped = 0;

      for (const [i, row] of toAction.entries()) {
        if (ctx.signal?.aborted) break;
        ctx.progress(i, toAction.length, row.title);
        const entry = onList.get(row.guid)!;

        if (inLibrary(entry, index)) {
          mark(row.guid, { status: "present", error: "" });
          present++;
          if (cfg.removeOnAvailable && (await tidyUp(plexToken, row.ratingKey, row.title, ctx.signal))) removed++;
          continue;
        }

        const service = serviceFor(row.type);
        const target = cfg[service];
        if (!target.enabled) {
          mark(row.guid, { status: "skipped", error: `${service} is not enabled for watchlist sync` });
          skipped++;
          continue;
        }
        if (!row.externalId) {
          // No provider id means the only way to identify it to an *Arr is by
          // title, which is how you end up downloading the wrong film.
          mark(row.guid, { status: "skipped", error: "Plex reported no IMDb/TMDb/TVDb id for this item" });
          skipped++;
          continue;
        }
        const instance = resolveArrInstance(service, target.instanceId);
        if (!instance) {
          mark(row.guid, { status: "skipped", error: `${service} is not configured` });
          skipped++;
          continue;
        }
        if (!target.qualityProfileId || !target.rootFolderPath) {
          mark(row.guid, { status: "skipped", error: `${service} has no quality profile or root folder chosen` });
          skipped++;
          continue;
        }

        // The cap counts attempts, including the ones a dry run only pretends
        // to make — a dry run whose numbers don't match the real one is not a
        // rehearsal of anything.
        if (attempts >= cfg.maxAddsPerRun) {
          capped++;
          continue;
        }
        attempts++;

        if (cfg.dryRun) {
          ctx.log(`[watchlist] DRY RUN — would add ${row.externalId} (${row.title}) to ${service}`);
          // Left actionable on purpose: a dry run must leave the work to do.
          continue;
        }

        const arrConfig = { service, url: instance.url, apiKey: instance.apiKey } as const;
        try {
          const lookup = await lookupByExternalId(arrConfig, row.externalId);
          if (!lookup) {
            mark(row.guid, { status: "skipped", error: `${service} could not find ${row.externalId}` });
            skipped++;
            continue;
          }
          const result = await addItem(arrConfig, lookup, {
            qualityProfileId: target.qualityProfileId,
            rootFolderPath: target.rootFolderPath,
            monitor: target.monitor,
            searchOnAdd: target.searchOnAdd,
          });
          if (result.status === "failed") {
            mark(row.guid, { status: "failed", error: result.error ?? "unknown error" });
            failed++;
            emitEvent("watchlist.failed", `Couldn't request "${row.title}" — ${result.error ?? "unknown error"}`, {
              guid: row.guid,
              service,
            });
            continue;
          }
          // "exists" counts as requested: it is already under management, and
          // leaving it actionable would mean looking it up again every run
          // forever.
          mark(row.guid, { status: "requested", requestedAt: Date.now(), error: "" });
          added++;
          ctx.log(
            `[watchlist] ${service}: ${result.status === "added" ? "added" : "already had"} "${row.title}"` +
              `${result.id ? ` (id=${result.id})` : ""}`,
          );
          emitEvent("watchlist.requested", `Requested "${row.title}" from ${service}`, {
            guid: row.guid,
            service,
            title: row.title,
          });
        } catch (err) {
          mark(row.guid, { status: "failed", error: errorMessage(err) });
          failed++;
          emitEvent("watchlist.failed", `Couldn't request "${row.title}" — ${errorMessage(err)}`, {
            guid: row.guid,
            service,
          });
        }
      }

      if (capped > 0) {
        ctx.log(`[watchlist] Cap of ${cfg.maxAddsPerRun} reached — ${capped} item(s) left for the next run.`);
      }
    }

    // ── Has what we asked for arrived? ────────────────────────────────────
    if (pendingArrival.length > 0) {
      const { findByExternalId } = await import("@rube/arr");
      for (const row of pendingArrival) {
        if (ctx.signal?.aborted) break;
        if (!row.externalId) continue;
        const service = serviceFor(row.type);
        const instance = resolveArrInstance(service, cfg[service].instanceId);
        if (!instance) continue;
        try {
          const record = await findByExternalId(
            { service, url: instance.url, apiKey: instance.apiKey },
            row.externalId,
          );
          if (!record?.hasFile) continue;
          mark(row.guid, { status: "present", error: "" });
          present++;
          if (await tidyUp(plexToken, row.ratingKey, row.title, ctx.signal)) removed++;
        } catch (err) {
          // A dead *Arr must not turn a pending item into a failed one — the
          // request itself is fine, we just can't see it yet.
          log.warn("could not check availability", { title: row.title, err: errorMessage(err) });
        }
      }
    }

    for (const row of strays) {
      if (ctx.signal?.aborted) break;
      if (await tidyUp(plexToken, row.ratingKey, row.title, ctx.signal)) removed++;
    }

    const parts = [];
    if (added > 0) parts.push(`requested ${added}`);
    if (present > 0) parts.push(`${present} already in the library`);
    if (skipped > 0) parts.push(`skipped ${skipped}`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (removed > 0) parts.push(`removed ${removed} from the watchlist`);
    // The job is quiet, which suppresses the event only while this text is
    // unchanged — so a run that did nothing has to produce one stable string
    // rather than a set of counts that are always zero.
    if (parts.length === 0) return `Watchlist: nothing new (${entries.length} item(s) on the list).`;
    return `Watchlist: ${parts.join(", ")}.`;
  }

  /**
   * Forget a settled row so the next run treats it as new again.
   *
   * The one escape hatch the ledger needs: a skip caused by a misconfiguration
   * the user has since fixed is otherwise permanent, and "delete it from Plex
   * and add it again" is not an answer anybody should have to find.
   */
  function retryWatchlistItem(guid: string): void {
    db.update(watchlistItems)
      .set({ status: "new", error: "", requestedAt: null })
      .where(and(eq(watchlistItems.guid, guid), inArray(watchlistItems.status, ["skipped", "failed", "requested"])))
      .run();
  }

  return { syncWatchlist, listWatchlistItems, watchlistCounts, retryWatchlistItem, watchlistSettings: settings };
}

export type Watchlist = ReturnType<typeof createWatchlist>;

export const WatchlistToken = token<Watchlist>("domain.watchlist");
