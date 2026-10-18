/**
 * The two *Arr problems a click can fix.
 *
 * - **Downloaded, not in Plex** — scan the folder in Plex. Almost always the
 *   cause is an import Plex never noticed. The catch is the path: the *Arr
 *   and Plex usually name the folder differently, so the Plex-side name is
 *   learnt from a matched item in the same root folder (`arr-paths.ts`). A
 *   root folder nothing in Plex has come from offers no fix rather than a
 *   guess, because a scan of a path Plex doesn't have succeeds and does
 *   nothing.
 * - **Failed to import** — mark the grab failed in the *Arr. That is the
 *   *Arr's own remedy: it blocklists the release, frees the download and,
 *   with failed-download handling on, searches for another. The resulting
 *   `downloadFailed` history event is what clears the problem on the next
 *   activity sync.
 */
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { arrMovies, arrSeries, mediaItems, showChecks, type Db } from "@tinkerbell/db";
import { MINUTE_MS, type ArrInstance } from "@tinkerbell/core";
import type { ArrIssue } from "@tinkerbell/domain.arr-library";
import type { PlexClient } from "@tinkerbell/plex";
import { createRadarrClient } from "@tinkerbell/radarr";
import { createSonarrClient } from "@tinkerbell/sonarr";
import { folderOf, learnPlexRoot, toPlexPath } from "./arr-paths.ts";
import { showFolder } from "./ordering.ts";

export type MarkGrabFailed = (instance: ArrInstance, historyId: number) => Promise<void>;

export interface ArrFixesDeps {
  db: Db;
  plex: () => PlexClient;
  arrInstances: () => ArrInstance[];
  now: () => number;
  /** For tests; production asks the instance's own client. */
  markGrabFailed?: MarkGrabFailed;
}

/** Thrown when a fix can't be attempted; the caller turns it into its own error type. */
export class ArrFixError extends Error {}

/**
 * How long a learnt root is reused. A bulk fix of ninety films would otherwise
 * ask Plex about the same sibling ninety times; a remount is rare, and ten
 * minutes is the longest a stale one can misdirect a scan.
 */
const ROOT_TTL_MS = 10 * MINUTE_MS;

/** How many matched siblings to try before giving up on a root folder. */
const SIBLINGS_TRIED = 5;

const rootKey = (instanceId: string, root: string) => `${instanceId}\u0000${root}`;

const defaultMarkGrabFailed: MarkGrabFailed = async (instance, historyId) => {
  const opts = { url: instance.url, apiKey: instance.apiKey, signal: AbortSignal.timeout(30_000) };
  const client = instance.service === "radarr" ? createRadarrClient(opts) : createSonarrClient(opts);
  await client.markHistoryFailed(historyId);
};

export function createArrFixes(deps: ArrFixesDeps) {
  const { db } = deps;
  const markGrabFailed = deps.markGrabFailed ?? defaultMarkGrabFailed;
  const learnt = new Map<string, { plexRoot: string; sectionId: string; at: number }>();

  function tableFor(service: ArrIssue["service"]) {
    return service === "radarr" ? arrMovies : arrSeries;
  }

  /**
   * Every (instance, root folder) with something Plex has matched in it — the
   * root folders a scan can be offered for. Two grouped reads, run with the
   * provider, so `fixable` costs no Plex call.
   */
  function rootsWithMatches(): Set<string> {
    const out = new Set<string>();
    for (const table of [arrMovies, arrSeries]) {
      const rows = db
        .selectDistinct({ instanceId: table.instanceId, root: table.rootFolderPath })
        .from(table)
        .where(and(isNotNull(table.plexRatingKey), isNull(table.deletedAt), ne(table.rootFolderPath, "")))
        .all();
      for (const r of rows) out.add(rootKey(r.instanceId, r.root));
    }
    return out;
  }

  function canScan(issue: ArrIssue, roots: Set<string>): boolean {
    return !!issue.path && !!issue.rootFolderPath && roots.has(rootKey(issue.instanceId, issue.rootFolderPath));
  }

  /** Where Plex keeps one matched item, as a folder. */
  async function plexFolderOf(plex: PlexClient, service: ArrIssue["service"], ratingKey: string) {
    if (service === "sonarr") {
      // The ordering scan has usually recorded it already.
      const known = db
        .select({ folder: showChecks.plexFolder })
        .from(showChecks)
        .where(eq(showChecks.plexRatingKey, ratingKey))
        .get()?.folder;
      return known ?? showFolder(await plex.showLeaves(ratingKey));
    }
    const file = (await plex.getItemDetail(ratingKey)).media[0]?.parts[0]?.file;
    return file ? folderOf(file) : null;
  }

  async function learnRoot(plex: PlexClient, issue: ArrIssue, root: string) {
    const key = rootKey(issue.instanceId, root);
    const cached = learnt.get(key);
    if (cached && deps.now() - cached.at < ROOT_TTL_MS) return cached;

    const table = tableFor(issue.service);
    const siblings = db
      .select({ path: table.path, ratingKey: table.plexRatingKey, sectionId: mediaItems.sectionId })
      .from(table)
      .innerJoin(mediaItems, eq(mediaItems.ratingKey, table.plexRatingKey))
      .where(
        and(
          eq(table.instanceId, issue.instanceId),
          eq(table.rootFolderPath, root),
          isNull(table.deletedAt),
          ne(table.path, ""),
        ),
      )
      .limit(SIBLINGS_TRIED)
      .all();

    for (const s of siblings) {
      const folder = await plexFolderOf(plex, issue.service, s.ratingKey!).catch(() => null);
      const plexRoot = folder ? learnPlexRoot(root, s.path, folder) : null;
      if (plexRoot) {
        const found = { plexRoot, sectionId: s.sectionId, at: deps.now() };
        learnt.set(key, found);
        return found;
      }
    }
    return null;
  }

  async function scanInPlex(issue: ArrIssue): Promise<string> {
    if (!issue.path || !issue.rootFolderPath) throw new ArrFixError(`No folder is known for "${issue.title}".`);
    const plex = deps.plex();
    const where = await learnRoot(plex, issue, issue.rootFolderPath);
    if (!where) {
      throw new ArrFixError(
        `Couldn't work out where Plex sees ${issue.rootFolderPath}: nothing Plex has matched from it lives in a folder of the same name.`,
      );
    }
    const path = toPlexPath(issue.rootFolderPath, issue.path, where.plexRoot);
    if (!path) throw new ArrFixError(`${issue.path} isn't under ${issue.rootFolderPath}.`);
    await plex.scanPath(where.sectionId, path);
    return `Asked Plex to scan ${path}. It clears after the next *Arr sync.`;
  }

  async function markFailed(issue: ArrIssue): Promise<string> {
    const instance = deps.arrInstances().find((i) => i.id === issue.instanceId);
    if (!instance) throw new ArrFixError(`The instance that grabbed "${issue.title}" is no longer configured.`);
    const ids = issue.grabHistoryIds ?? [];
    if (ids.length === 0) throw new ArrFixError(`No grab is recorded for "${issue.title}".`);
    // One at a time: these are writes to someone's *Arr, and the first failure
    // (a history row the *Arr has since pruned) shouldn't hide whether the rest
    // went through.
    let marked = 0;
    let lastError: unknown;
    for (const id of ids) {
      try {
        await markGrabFailed(instance, id);
        marked++;
      } catch (err) {
        lastError = err;
      }
    }
    if (marked === 0) {
      throw new ArrFixError(
        `${instance.name} refused: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    const what = marked === 1 ? "the grab" : `${marked} grabs`;
    return `Marked ${what} of "${issue.title}" failed in ${instance.name}, which blocklists the release and frees it to search again.`;
  }

  return { rootsWithMatches, canScan, scanInPlex, markFailed };
}
