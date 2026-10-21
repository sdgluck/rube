/**
 * Compare every linked Sonarr series with its Plex show, episode by episode.
 *
 * Two requests per show — Plex's `allLeaves` and Sonarr's episode list —
 * which is why this runs as a job and stores what it finds in `show_checks`
 * rather than running when the page opens. A show is fetched again only when
 * its signature moves: the episode counts on either side, or the ordering
 * Plex reports for it. So the first scan of a 700-show library is the slow
 * one, and every scan after it touches the handful of shows that changed.
 *
 * That table is also why the job carries no checkpoint. An interrupted scan
 * has already written every show it finished, and the next one skips them.
 */
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { arrSeries, mediaItems, showChecks, type Db } from "@rube/db";
import type { ArrInstance } from "@rube/core";
import { createSonarrClient, type SonarrClient } from "@rube/sonarr";
import type { PlexClient } from "@rube/plex";
import { compareShow, showFolder } from "./ordering.ts";

export interface ScanDeps {
  db: Db;
  plex: (opts?: { signal?: AbortSignal }) => PlexClient;
  sonarrInstances: () => ArrInstance[];
  /** Swappable so a test can count requests; production builds one per instance. */
  sonarrClient?: (instance: ArrInstance, signal?: AbortSignal) => SonarrClient;
  now: () => number;
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Check every show, ignoring signatures. */
  force?: boolean;
  onProgress?: (done: number, total: number) => void;
  log?: (line: string) => void;
}

export interface ScanResult {
  /** Linked series with files, across every Sonarr. */
  total: number;
  checked: number;
  unchanged: number;
  failed: number;
  /** Rows removed because their series is gone or no longer linked to Plex. */
  pruned: number;
}

/** How many shows are fetched at once. Enough to hide latency; few enough not to lean on Plex. */
const CONCURRENCY = 3;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createShowScan(deps: ScanDeps) {
  const { db } = deps;
  const sonarrFor =
    deps.sonarrClient ??
    ((instance: ArrInstance, signal?: AbortSignal) =>
      createSonarrClient({ url: instance.url, apiKey: instance.apiKey, signal }));

  /** Every series worth comparing: linked to a Plex show, with at least one file. */
  function candidates(instanceIds: string[]) {
    return db
      .select({
        instanceId: arrSeries.instanceId,
        arrId: arrSeries.arrId,
        title: arrSeries.title,
        ratingKey: arrSeries.plexRatingKey,
        episodeCount: arrSeries.episodeCount,
        episodeFileCount: arrSeries.episodeFileCount,
        sectionId: mediaItems.sectionId,
        leafCount: mediaItems.leafCount,
      })
      .from(arrSeries)
      .innerJoin(mediaItems, eq(mediaItems.ratingKey, arrSeries.plexRatingKey))
      .where(and(isNull(arrSeries.deletedAt), isNotNull(arrSeries.plexRatingKey), gt(arrSeries.episodeFileCount, 0)))
      .all()
      .filter((r) => instanceIds.includes(r.instanceId));
  }

  /**
   * The ordering each show is on, as Plex reports it: its own, else its library's.
   *
   * One listing and one prefs read per section rather than a request per
   * show. A section that can't be read leaves its shows' ordering unknown,
   * which still lets the title comparison run — it just can't say which
   * ordering is in force.
   */
  async function orderings(plex: PlexClient, sectionIds: string[], log: (line: string) => void) {
    const byShow = new Map<string, string | null>();
    for (const sectionId of sectionIds) {
      try {
        const [library, shows] = await Promise.all([plex.sectionOrdering(sectionId), plex.sectionShows(sectionId)]);
        for (const show of shows) byShow.set(show.ratingKey, show.ordering ?? library);
      } catch (err) {
        log(`  Couldn't read episode orderings for library ${sectionId}: ${errorText(err)}`);
      }
    }
    return byShow;
  }

  async function scanShows(opts: ScanOptions = {}): Promise<ScanResult> {
    const log = opts.log ?? (() => {});
    const instances = deps.sonarrInstances();
    const result: ScanResult = { total: 0, checked: 0, unchanged: 0, failed: 0, pruned: 0 };

    const rows = candidates(instances.map((i) => i.id));
    result.total = rows.length;

    // A series deleted from Sonarr, or no longer linked, takes its finding
    // with it — otherwise a problem would outlive the show it was about.
    const keep = new Set(rows.map((r) => `${r.instanceId}\u0000${r.arrId}`));
    for (const existing of db
      .select({ instanceId: showChecks.instanceId, arrId: showChecks.arrId })
      .from(showChecks)
      .all()) {
      if (keep.has(`${existing.instanceId}\u0000${existing.arrId}`)) continue;
      db.delete(showChecks)
        .where(and(eq(showChecks.instanceId, existing.instanceId), eq(showChecks.arrId, existing.arrId)))
        .run();
      result.pruned++;
    }

    if (rows.length === 0) return result;

    const plex = deps.plex({ signal: opts.signal });
    const ordering = await orderings(plex, [...new Set(rows.map((r) => r.sectionId))], log);
    const previous = new Map(
      db
        .select({ instanceId: showChecks.instanceId, arrId: showChecks.arrId, signature: showChecks.signature })
        .from(showChecks)
        .all()
        .map((r) => [`${r.instanceId}\u0000${r.arrId}`, r.signature]),
    );
    const clients = new Map(instances.map((i) => [i.id, sonarrFor(i, opts.signal)]));

    let done = 0;
    let next = 0;
    async function worker(): Promise<void> {
      while (next < rows.length) {
        if (opts.signal?.aborted) return;
        const row = rows[next++];
        const ratingKey = row.ratingKey as string;
        const showOrdering = ordering.get(ratingKey) ?? null;
        const signature = `${row.leafCount ?? ""}:${row.episodeFileCount}:${row.episodeCount}:${showOrdering ?? ""}`;
        const key = `${row.instanceId}\u0000${row.arrId}`;

        if (!opts.force && previous.get(key) === signature) {
          result.unchanged++;
        } else {
          try {
            const [leaves, episodes] = await Promise.all([
              plex.showLeaves(ratingKey),
              (clients.get(row.instanceId) as SonarrClient).episodes(row.arrId),
            ]);
            const comparison = compareShow(leaves, episodes);
            const values = {
              plexRatingKey: ratingKey,
              title: row.title,
              signature,
              checkedAt: deps.now(),
              ordering: showOrdering,
              orderingEvidence: comparison.ordering,
              missingEpisodes: comparison.missing.length > 0 ? comparison.missing : null,
              plexFolder: showFolder(leaves),
              error: null,
            };
            // `fixedAt` is left alone: it records the last fix, and the page
            // compares it with `checkedAt` to say whether the fix has been
            // confirmed yet.
            db.insert(showChecks)
              .values({ instanceId: row.instanceId, arrId: row.arrId, ...values })
              .onConflictDoUpdate({ target: [showChecks.instanceId, showChecks.arrId], set: values })
              .run();
            result.checked++;
          } catch (err) {
            if (opts.signal?.aborted) return;
            result.failed++;
            log(`  ${row.title}: ${errorText(err)}`);
            // No signature, so the next scan tries this show again; whatever
            // was found last time stays visible meanwhile.
            const values = {
              plexRatingKey: ratingKey,
              title: row.title,
              signature: null,
              checkedAt: deps.now(),
              error: errorText(err),
            };
            db.insert(showChecks)
              .values({ instanceId: row.instanceId, arrId: row.arrId, ...values })
              .onConflictDoUpdate({ target: [showChecks.instanceId, showChecks.arrId], set: values })
              .run();
          }
        }
        done++;
        opts.onProgress?.(done, rows.length);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));
    return result;
  }

  /** Make the next scan fetch these shows again, whatever their signature says. */
  function markStale(ratingKey: string, fixedAt?: number): void {
    db.update(showChecks)
      .set({ signature: null, ...(fixedAt !== undefined ? { fixedAt } : {}) })
      .where(eq(showChecks.plexRatingKey, ratingKey))
      .run();
  }

  return { scanShows, markStale };
}
