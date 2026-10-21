/**
 * Unused 4K: films whose 2160p file nobody has ever watched in 4K, and the
 * swap that replaces each with a 1080p copy without a gap.
 *
 * **Who counts as having watched it in 4K.** A play Plex direct-played or
 * direct-streamed (`directplay`, `copy`) delivered the 4K video to somebody.
 * A transcode didn't — the client couldn't take it, which is the whole case
 * for the smaller file. A film is offered only when *every* play on record is
 * a transcode we can see: if `watch_state` has counted more plays than the
 * session log still holds (pruned by retention, or backfilled from Plex
 * history without a decision), some plays are unaccounted for and the film is
 * left alone. Wrongly offering to shrink somebody's 4K film is the expensive
 * mistake; missing a candidate is not.
 *
 * **Why a state machine.** Radarr never downgrades — see `qualitySwaps` in
 * the schema. Each swap is walked a poll at a time by `advanceAll`, which the
 * `quality-swaps` job calls every few minutes. ManualImport is what replaces
 * the file: it imports a release Radarr refused as "not an upgrade" and
 * deletes (or recycles) the 4K file in the same step, verified against a real
 * Radarr rather than assumed. Every failure puts the film's quality profile
 * back, so a swap that goes nowhere leaves things exactly as they were.
 */

import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { token } from "@rube/container";
import { currentActor, errorMessage, type ArrInstances } from "@rube/core";
import { qualitySwaps, type Db } from "@rube/db";
import type { EventBus } from "@rube/ports";
import { createRadarrClient, type RadarrClient, type RadarrRelease } from "@rube/radarr";
import { formatFileSize } from "@rube/contracts";

const DAY_MS = 86_400_000;
/** Not offered until it has had a month to be watched. */
const MIN_AGE_DAYS = 30;
/** A download still going after this long isn't going to finish. */
const DOWNLOAD_DEADLINE_MS = 3 * DAY_MS;
/** A grab that hasn't shown up in the queue in this long never will. */
const QUEUE_APPEAR_DEADLINE_MS = 30 * 60_000;

export const ACTIVE_SWAP_STATES = ["pending", "downloading", "importing"] as const;
export type SwapState = (typeof ACTIVE_SWAP_STATES)[number] | "done" | "failed" | "cancelled";
export type QualitySwapRow = typeof qualitySwaps.$inferSelect;

export interface UnusedFourK {
  instanceId: string;
  instanceName: string;
  arrMovieId: number;
  ratingKey: string;
  title: string;
  year: number | null;
  fileQuality: string;
  size: number | null;
  qualityProfileId: number | null;
  /** Every one a transcode — that's what makes it a candidate. */
  plays: number;
  lastPlayedAt: number | null;
  /** Plex's addedAt, in seconds. */
  addedAt: number | null;
}

/**
 * Radarr's objections that only say "you already have something better".
 * Those are the point of the exercise; any other rejection — size, a
 * blocklisted release, a quality the target profile doesn't allow — stands.
 */
const IGNORABLE_REJECTION = /upgrade|cutoff|existing file|equal or higher|already meets/i;

export function chooseRelease(releases: RadarrRelease[]): RadarrRelease | null {
  const usable = releases
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        r.quality?.quality?.resolution === 1080 && (r.rejections ?? []).every((x) => IGNORABLE_REJECTION.test(x)),
    );
  // `releaseWeight` is Radarr's own ranking (lower is better), the order its
  // interactive search shows. Ties keep the order Radarr returned them in.
  usable.sort((a, b) => (a.r.releaseWeight ?? Infinity) - (b.r.releaseWeight ?? Infinity) || a.i - b.i);
  return usable[0]?.r ?? null;
}

function resolutionOf(quality: { quality?: { resolution?: number } } | undefined): number | null {
  return quality?.quality?.resolution ?? null;
}

export interface QualitySwapsDeps {
  db: Db;
  arr: ArrInstances;
  emitEvent: EventBus;
  /** Replaced in tests to pin "now" for the deadlines. */
  now?: () => number;
}

export function createQualitySwaps(deps: QualitySwapsDeps) {
  const { db, arr, emitEvent } = deps;
  const now = deps.now ?? Date.now;

  function unusedFourK(): UnusedFourK[] {
    const minAddedAt = Math.floor((now() - MIN_AGE_DAYS * DAY_MS) / 1000);
    const active = sql.join(
      ACTIVE_SWAP_STATES.map((s) => sql`${s}`),
      sql`, `,
    );
    const rows = db.all<{
      instance_id: string;
      arr_id: number;
      rating_key: string;
      title: string;
      year: number | null;
      file_quality: string;
      size_on_disk: number | null;
      quality_profile_id: number | null;
      plays: number;
      last_played_at: number | null;
      added_at: number | null;
    }>(sql`
      with linked as (
        select plex_rating_key from arr_movies
        where deleted_at is null and plex_rating_key is not null
        group by plex_rating_key
        -- One Radarr only. A film kept by a 1080p and a 4K instance is
        -- already the two-copy setup this page exists to avoid needing.
        having count(*) = 1
      ),
      seen as (
        select rating_key,
          sum(case when decision = 'transcode' then 1 else 0 end) as transcoded,
          max(started_at) as last_at
        from playback_sessions
        group by rating_key
      ),
      counted as (
        select rating_key, sum(plays) as plays, max(last_played_at) as last_at
        from watch_state group by rating_key
      )
      select am.instance_id, am.arr_id, mi.rating_key, am.title, am.year, am.file_quality,
        am.size_on_disk, am.quality_profile_id,
        coalesce(c.plays, 0) as plays,
        coalesce(c.last_at, s.last_at) as last_played_at,
        mi.added_at
      from media_items mi
      join linked l on l.plex_rating_key = mi.rating_key
      join arr_movies am on am.plex_rating_key = mi.rating_key and am.deleted_at is null
      left join seen s on s.rating_key = mi.rating_key
      left join counted c on c.rating_key = mi.rating_key
      where mi.type = 'movie'
        and mi.video_resolution = '4k'
        and am.has_file = 1
        and am.file_quality like '%2160%'
        and (mi.added_at is null or mi.added_at < ${minAddedAt})
        -- Every play is one we saw, and saw transcoded. A play missing from
        -- the log might have been in 4K; see the header.
        and coalesce(c.plays, 0) = coalesce(s.transcoded, 0)
        and not exists (
          select 1 from playback_sessions p
          where p.rating_key = mi.rating_key and p.decision <> 'transcode'
        )
        and not exists (
          select 1 from quality_swaps q
          where q.instance_id = am.instance_id and q.arr_movie_id = am.arr_id and q.state in (${active})
        )
      order by am.size_on_disk desc
    `);

    const names = new Map(arr.arrInstances("radarr").map((i) => [i.id, i.name]));
    return rows
      .filter((r) => names.has(r.instance_id))
      .map((r) => ({
        instanceId: r.instance_id,
        instanceName: names.get(r.instance_id)!,
        arrMovieId: r.arr_id,
        ratingKey: r.rating_key,
        title: r.title,
        year: r.year,
        fileQuality: r.file_quality,
        size: r.size_on_disk,
        qualityProfileId: r.quality_profile_id,
        plays: r.plays,
        lastPlayedAt: r.last_played_at,
        addedAt: r.added_at,
      }));
  }

  function listSwaps(opts: { limit?: number } = {}): QualitySwapRow[] {
    return db
      .select()
      .from(qualitySwaps)
      .orderBy(
        sql`case when ${qualitySwaps.state} in ('pending','downloading','importing') then 0 else 1 end`,
        sql`${qualitySwaps.updatedAt} desc`,
      )
      .limit(opts.limit ?? 100)
      .all();
  }

  function activeCount(): number {
    return (
      db
        .select({ n: sql<number>`count(*)` })
        .from(qualitySwaps)
        .where(inArray(qualitySwaps.state, [...ACTIVE_SWAP_STATES]))
        .get()?.n ?? 0
    );
  }

  /**
   * Queue swaps. Nothing talks to Radarr here — the search takes minutes —
   * so this only records intent, and the job picks the rows up.
   *
   * Only films still on the candidate list are accepted: the list is the
   * check that nobody watches them in 4K, and a request built from a page
   * that has since gone stale must not skip it.
   */
  function start(input: {
    movies: Array<{ instanceId: string; arrMovieId: number }>;
    profiles: Record<string, number>;
  }) {
    const candidates = new Map(unusedFourK().map((c) => [`${c.instanceId}:${c.arrMovieId}`, c]));
    const actor = currentActor();
    const at = now();
    const queued: string[] = [];
    const skipped: string[] = [];
    for (const m of input.movies) {
      const c = candidates.get(`${m.instanceId}:${m.arrMovieId}`);
      const toProfileId = input.profiles[m.instanceId];
      if (!c || toProfileId == null) {
        skipped.push(c?.title ?? `${m.instanceId}:${m.arrMovieId}`);
        continue;
      }
      db.insert(qualitySwaps)
        .values({
          id: randomUUID(),
          instanceId: m.instanceId,
          arrMovieId: m.arrMovieId,
          plexRatingKey: c.ratingKey,
          title: c.year ? `${c.title} (${c.year})` : c.title,
          fromProfileId: c.qualityProfileId,
          toProfileId,
          fromQuality: c.fileQuality,
          fromSize: c.size,
          state: "pending",
          message: "Waiting for its turn to search",
          createdBy: actor.username || actor.source,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      queued.push(c.title);
    }
    return { queued: queued.length, skipped };
  }

  function update(id: string, patch: Partial<QualitySwapRow>): void {
    db.update(qualitySwaps)
      .set({ ...patch, updatedAt: now() })
      .where(eq(qualitySwaps.id, id))
      .run();
  }

  async function restoreProfile(client: RadarrClient, swap: QualitySwapRow): Promise<string> {
    if (swap.fromProfileId == null) return "";
    try {
      await client.updateMovie(swap.arrMovieId, (cur) => ({ ...cur.raw, qualityProfileId: swap.fromProfileId }));
      return "";
    } catch (err) {
      return ` Couldn't put its quality profile back: ${errorMessage(err)}`;
    }
  }

  async function fail(client: RadarrClient | null, swap: QualitySwapRow, message: string): Promise<void> {
    const suffix = client ? await restoreProfile(client, swap) : "";
    update(swap.id, { state: "failed", message: message + suffix, finishedAt: now() });
    emitEvent("quality.swap_failed", `Couldn't swap "${swap.title}" to 1080p — ${message}`, { swapId: swap.id });
  }

  function finish(swap: QualitySwapRow, file: { quality?: { quality?: { name?: string } }; size?: number }): void {
    const freed = swap.fromSize != null && file.size != null ? swap.fromSize - file.size : null;
    const message = freed != null && freed > 0 ? `Replaced — freed ${formatFileSize(freed)}` : "Replaced";
    update(swap.id, {
      state: "done",
      toQuality: file.quality?.quality?.name ?? "",
      toSize: file.size ?? null,
      message,
      finishedAt: now(),
    });
    emitEvent("quality.swapped", `"${swap.title}" is now ${file.quality?.quality?.name ?? "1080p"}. ${message}.`, {
      swapId: swap.id,
      freedBytes: freed,
    });
  }

  /** Set the 1080p profile, search, grab. The slow step: one interactive search. */
  async function stepPending(client: RadarrClient, swap: QualitySwapRow, log: (line: string) => void): Promise<void> {
    const movie = await client.movie(swap.arrMovieId);
    if (!movie) return fail(null, swap, "It is no longer in Radarr.");
    const [file] = await client.files(swap.arrMovieId);
    if (!file) return fail(null, swap, "It has no file in Radarr any more.");
    const resolution = resolutionOf(file.quality);
    if (resolution != null && resolution <= 1080) return finish(swap, file);

    // Recorded from Radarr rather than the mirror: this is what a failure
    // restores, so it has to be what is actually set right now.
    const fromProfileId = movie.qualityProfileId ?? swap.fromProfileId;
    const current = { ...swap, fromProfileId: fromProfileId ?? null };
    update(swap.id, { fromProfileId, fromSize: file.size ?? swap.fromSize, message: "Searching for a 1080p release" });

    // The profile first: with the 4K one still set, the next RSS sync could
    // grab a 4K "upgrade" to the file we are about to replace.
    await client.updateMovie(swap.arrMovieId, (cur) => ({ ...cur.raw, qualityProfileId: swap.toProfileId }));

    log(`  ${swap.title}: searching`);
    const releases = await client.releases(swap.arrMovieId);
    const pick = chooseRelease(releases);
    if (!pick) {
      const at1080 = releases.filter((r) => r.quality?.quality?.resolution === 1080).length;
      return fail(
        client,
        current,
        releases.length === 0
          ? "The indexers returned nothing for it."
          : `None of ${at1080} 1080p release(s) (of ${releases.length} found) is one Radarr would accept.`,
      );
    }

    await client.grabRelease(pick);
    log(`  ${swap.title}: grabbed ${pick.title}`);
    update(swap.id, {
      state: "downloading",
      releaseTitle: pick.title,
      grabbedAt: now(),
      message: `Grabbed ${pick.title}${pick.size ? ` (${formatFileSize(pick.size)})` : ""}`,
    });
  }

  async function stepDownloading(client: RadarrClient, swap: QualitySwapRow): Promise<void> {
    const items = await client.queueForMovie(swap.arrMovieId);
    const item =
      items.find((i) => swap.downloadId && i.downloadId === swap.downloadId) ??
      items.find((i) => i.title === swap.releaseTitle);

    if (!item) {
      // Gone from the queue: Radarr may have imported it itself (a profile
      // that ranks 1080p above 2160p would), or it vanished.
      const [file] = await client.files(swap.arrMovieId);
      const resolution = resolutionOf(file?.quality);
      if (file && resolution != null && resolution <= 1080) return finish(swap, file);
      if (swap.downloadId) return fail(client, swap, "The download left Radarr's queue without being imported.");
      if (now() - (swap.grabbedAt ?? swap.updatedAt) > QUEUE_APPEAR_DEADLINE_MS) {
        return fail(client, swap, "The grab never appeared in Radarr's queue.");
      }
      return;
    }

    const downloadId = item.downloadId ?? swap.downloadId;
    const state = item.trackedDownloadState ?? "";
    if (state === "failedPending" || state === "failed" || item.status === "failed") {
      const why =
        item.errorMessage || item.statusMessages?.flatMap((m) => m.messages ?? [])[0] || "the download client gave up";
      return fail(client, swap, `The download failed: ${why}`);
    }

    if ((state === "importPending" || state === "importBlocked") && downloadId) {
      const files = (await client.manualImportCandidates(downloadId)).filter(
        (f) => f.movie?.id === swap.arrMovieId && resolutionOf(f.quality) === 1080,
      );
      // A release can carry a sample or extras; the film is the biggest file.
      const film = files.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
      if (!film) return fail(client, swap, "The download finished but has no 1080p file Radarr can import.");
      const command = await client.manualImport([
        {
          path: film.path,
          movieId: swap.arrMovieId,
          quality: film.quality,
          languages: film.languages,
          releaseGroup: film.releaseGroup,
          downloadId,
          indexerFlags: film.indexerFlags,
        },
      ]);
      update(swap.id, {
        state: "importing",
        downloadId,
        commandId: command.id,
        message: "Importing, replacing the 4K file",
      });
      return;
    }

    if (now() - (swap.grabbedAt ?? swap.createdAt) > DOWNLOAD_DEADLINE_MS) {
      await client.removeFromQueue(item.id, { removeFromClient: true, blocklist: false }).catch(() => {});
      return fail(client, swap, "The download didn't finish within three days, so it was removed.");
    }

    const pct = item.size ? Math.round(100 * (1 - (item.sizeleft ?? item.size) / item.size)) : null;
    update(swap.id, {
      downloadId: downloadId ?? null,
      message: pct != null ? `Downloading — ${pct}%` : "Downloading",
    });
  }

  async function stepImporting(client: RadarrClient, swap: QualitySwapRow): Promise<void> {
    if (swap.commandId == null) return fail(client, swap, "Lost track of the import.");
    const command = await client.commands.status(swap.commandId);
    if (command.status === "queued" || command.status === "started") return;
    const [file] = await client.files(swap.arrMovieId);
    const resolution = resolutionOf(file?.quality);
    if (file && resolution != null && resolution <= 1080) return finish(swap, file);
    return fail(
      client,
      swap,
      `The import ${command.status}${command.message ? `: ${command.message}` : ""}; the 4K file is still there.`,
    );
  }

  /**
   * Move every active swap on by at most one step.
   *
   * `searchBudget` caps the interactive searches per call: each one hits every
   * indexer and takes minutes, and fifty queued swaps must not become fifty
   * searches in one go. The cheap steps (queue and command polls) all run.
   */
  async function advanceAll(opts: { signal?: AbortSignal; searchBudget?: number; log?: (line: string) => void } = {}) {
    const log = opts.log ?? (() => {});
    let searches = opts.searchBudget ?? 1;
    const rows = db
      .select()
      .from(qualitySwaps)
      .where(inArray(qualitySwaps.state, [...ACTIVE_SWAP_STATES]))
      .orderBy(asc(qualitySwaps.createdAt))
      .all();
    const instances = new Map(arr.arrInstances("radarr").map((i) => [i.id, i]));
    const counts = { advanced: 0, waiting: 0, errors: 0 };

    for (const swap of rows) {
      if (opts.signal?.aborted) break;
      const instance = instances.get(swap.instanceId);
      if (!instance) {
        await fail(null, swap, "Its Radarr instance has been removed from Rube.");
        continue;
      }
      if (swap.state === "pending" && searches <= 0) {
        counts.waiting++;
        continue;
      }
      const client = createRadarrClient({ url: instance.url, apiKey: instance.apiKey, signal: opts.signal });
      try {
        if (swap.state === "pending") {
          searches--;
          await stepPending(client, swap, log);
        } else if (swap.state === "downloading") await stepDownloading(client, swap);
        else await stepImporting(client, swap);
        counts.advanced++;
      } catch (err) {
        // Transient by assumption — Radarr restarting, an indexer timing out.
        // The row stays where it is and the next poll tries again; the
        // deadlines above are what end a swap that never recovers.
        counts.errors++;
        update(swap.id, { message: `Will retry: ${errorMessage(err)}` });
        log(`  ${swap.title}: ${errorMessage(err)}`);
      }
    }
    return { active: rows.length, ...counts };
  }

  /**
   * Stop a swap. Before the import, that is always safe: drop the download,
   * put the profile back, and the 4K file was never touched. Once importing,
   * it is Radarr's to finish.
   */
  async function cancel(id: string): Promise<{ ok: boolean; message: string }> {
    const swap = db.select().from(qualitySwaps).where(eq(qualitySwaps.id, id)).get();
    if (!swap) return { ok: false, message: "No such swap." };
    if (swap.state === "importing") return { ok: false, message: "It is already importing; Radarr will finish it." };
    if (!(ACTIVE_SWAP_STATES as readonly string[]).includes(swap.state))
      return { ok: false, message: "It has already finished." };

    const instance = arr.arrInstances("radarr").find((i) => i.id === swap.instanceId);
    let note = "";
    if (instance && swap.state === "downloading") {
      const client = createRadarrClient({ url: instance.url, apiKey: instance.apiKey });
      try {
        const items = await client.queueForMovie(swap.arrMovieId);
        const item = items.find(
          (i) => (swap.downloadId && i.downloadId === swap.downloadId) || i.title === swap.releaseTitle,
        );
        if (item) await client.removeFromQueue(item.id, { removeFromClient: true, blocklist: false });
      } catch (err) {
        note = ` Couldn't remove the download: ${errorMessage(err)}`;
      }
      note += await restoreProfile(client, swap);
    }
    update(swap.id, { state: "cancelled", message: `Cancelled.${note}`, finishedAt: now() });
    return { ok: true, message: `Cancelled.${note}` };
  }

  return { unusedFourK, listSwaps, activeCount, start, cancel, advanceAll };
}

export type QualitySwaps = ReturnType<typeof createQualitySwaps>;
export const QualitySwapsToken = token<QualitySwaps>("qualitySwaps");
