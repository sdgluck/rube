/* ─── Problems: what is wrong across Plex, the *Arrs and your rules ─────────
 *
 * One list of things worth fixing, each either fixable in a click or
 * dismissable. It began as a way to catch one specific failure — a show whose
 * Plex episode ordering doesn't match the way Sonarr names its files, so every
 * episode after the first split carries the wrong title — and absorbed the
 * *Arr reconciliation page, which was the same idea with no way to act on it.
 *
 * Fixes run only when someone presses the button. Every fix here changes
 * Plex: an ordering change rewrites a show's titles and artwork on refresh,
 * which is exactly what you want when the ordering was wrong and exactly what
 * you don't when this check was. A nightly job doing that unasked would be the
 * kind of automation that gets switched off.
 *
 * Dismissals are stored with a fingerprint of the evidence, so dismissing
 * "season 4 disagrees" doesn't also silence "season 5 disagrees" next month.
 */

import { eq, max } from "drizzle-orm";
import { token } from "@rube/container";
import { mediaItems, problemDismissals, showChecks, type Db } from "@rube/db";
import { PROBLEM_META, type ProblemKind } from "@rube/contracts";
import type { ArrInstance, ConfigStore } from "@rube/core";
import type { ChangeRecorder, EventBus } from "@rube/ports";
import type { RuleConflict } from "@rube/domain.rules";
import { isTvdbOrdering, type PlexClient } from "@rube/plex";
import type { SonarrClient } from "@rube/sonarr";
import { arrSubject, createProviders, type ArrReconcile, type Problem } from "./providers.ts";
import { ArrFixError, createArrFixes, type MarkGrabFailed } from "./arr-fixes.ts";
import { createShowScan } from "./scan.ts";

export interface ProblemsDeps {
  db: Db;
  config: ConfigStore;
  plex: (opts?: { signal?: AbortSignal }) => PlexClient;
  arrInstances: () => ArrInstance[];
  reconcile: ArrReconcile;
  ruleConflicts: () => RuleConflict[];
  recordChange: ChangeRecorder;
  emitEvent: EventBus;
  now: () => number;
  /** For tests; production builds a client per instance. */
  sonarrClient?: (instance: ArrInstance, signal?: AbortSignal) => SonarrClient;
  /** For tests; production asks the instance's own client. */
  markGrabFailed?: MarkGrabFailed;
}

export interface ProblemView extends Problem {
  dismissed: boolean;
}

export interface ProblemTarget {
  kind: ProblemKind;
  subject: string;
}

export interface FixResult {
  /** What happened, in a sentence for a toast. */
  message: string;
}

/** Thrown for a fix that can't be attempted — the router turns it into a 4xx, not a 500. */
export class ProblemFixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProblemFixError";
  }
}

/**
 * How long a computed open count is reused.
 *
 * The sidebar asks on every page load, and a rule-conflict check reads every
 * collection membership row. A minute-old badge is fine; a sidebar that
 * stutters because of it is not.
 */
const COUNT_TTL_MS = 60_000;

const key = (kind: string, subject: string) => `${kind}|${subject}`;

export function createProblems(deps: ProblemsDeps) {
  const { db } = deps;
  const arrFixes = createArrFixes({
    db,
    plex: () => deps.plex(),
    arrInstances: deps.arrInstances,
    now: deps.now,
    markGrabFailed: deps.markGrabFailed,
  });
  const providers = createProviders({
    db,
    reconcile: deps.reconcile,
    ruleConflicts: deps.ruleConflicts,
    arrInstances: deps.arrInstances,
    arrFixes,
  });
  const scan = createShowScan({
    db,
    plex: deps.plex,
    sonarrInstances: () => deps.arrInstances().filter((i) => i.service === "sonarr"),
    sonarrClient: deps.sonarrClient,
    now: deps.now,
  });

  let cachedCount: { value: number; at: number } | null = null;

  function dismissals() {
    return new Map(
      db
        .select()
        .from(problemDismissals)
        .all()
        .map((d) => [key(d.kind, d.subject), d]),
    );
  }

  /**
   * Every problem, each marked dismissed or not.
   *
   * A dismissal whose fingerprint no longer matches is ignored: the evidence
   * changed, so this is a different problem from the one that was waved off.
   */
  function list(): { problems: ProblemView[]; lastScannedAt: number | null } {
    const dismissed = dismissals();
    const problems = providers.detectAll().map((p) => ({
      ...p,
      dismissed: dismissed.get(key(p.kind, p.subject))?.fingerprint === p.fingerprint,
    }));
    const lastScannedAt =
      db
        .select({ at: max(showChecks.checkedAt) })
        .from(showChecks)
        .get()?.at ?? null;
    return { problems, lastScannedAt };
  }

  /** Open faults — what the badge counts and what gets announced. Advisories are left out of both. */
  function openFaults(): ProblemView[] {
    return list().problems.filter((p) => !p.dismissed && PROBLEM_META[p.kind].severity === "fault");
  }

  function openCount(): number {
    const now = deps.now();
    if (cachedCount && now - cachedCount.at < COUNT_TTL_MS) return cachedCount.value;
    const value = openFaults().length;
    cachedCount = { value, at: now };
    return value;
  }

  function find(kind: ProblemKind, subject: string): ProblemView {
    const problem = list().problems.find((p) => p.kind === kind && p.subject === subject);
    if (!problem) throw new ProblemFixError("That problem is no longer reported.");
    return problem;
  }

  function ratingKeyOf(subject: string): string {
    if (!subject.startsWith("plex:")) throw new ProblemFixError(`Not a Plex item: ${subject}`);
    return subject.slice("plex:".length);
  }

  async function fix(kind: ProblemKind, subject: string): Promise<FixResult> {
    const problem = find(kind, subject);
    if (!problem.fixable) throw new ProblemFixError(`"${problem.title}" has no automatic fix.`);
    cachedCount = null;

    if (kind === "inArrNotInPlex" || kind === "failedImport") {
      const source = kind === "inArrNotInPlex" ? deps.reconcile.inArrNotInPlex() : deps.reconcile.failedImports();
      const issue = source.find((i) => arrSubject(i) === subject);
      if (!issue) throw new ProblemFixError("That problem is no longer reported.");
      try {
        const message = kind === "inArrNotInPlex" ? await arrFixes.scanInPlex(issue) : await arrFixes.markFailed(issue);
        return { message };
      } catch (err) {
        if (err instanceof ArrFixError) throw new ProblemFixError(err.message);
        throw err;
      }
    }

    const ratingKey = ratingKeyOf(subject);
    const plex = deps.plex();

    switch (kind) {
      case "episodeOrdering": {
        const row = db
          .select({ ordering: showChecks.ordering })
          .from(showChecks)
          .where(eq(showChecks.plexRatingKey, ratingKey))
          .get();
        // A show already on TVDB ordering gets the refresh alone — writing the
        // pref again would change nothing, and the refresh is what's missing.
        const setOrdering = !isTvdbOrdering(row?.ordering);
        if (setOrdering) await plex.setShowOrdering(ratingKey, "tvdbAiring");
        await plex.refreshItem(ratingKey);
        scan.markStale(ratingKey, deps.now());
        return {
          message: setOrdering
            ? `Set "${problem.title}" to TheTVDB ordering and asked Plex to refresh it.`
            : `Asked Plex to refresh "${problem.title}".`,
        };
      }
      case "missingEpisodes": {
        const row = db
          .select({ folder: showChecks.plexFolder, sectionId: mediaItems.sectionId })
          .from(showChecks)
          .innerJoin(mediaItems, eq(mediaItems.ratingKey, showChecks.plexRatingKey))
          .where(eq(showChecks.plexRatingKey, ratingKey))
          .get();
        if (!row?.folder) throw new ProblemFixError(`No folder is known for "${problem.title}".`);
        await plex.scanPath(row.sectionId, row.folder);
        scan.markStale(ratingKey, deps.now());
        return { message: `Asked Plex to scan ${row.folder}.` };
      }
      case "unknownSize": {
        await plex.analyzeItem(ratingKey);
        return { message: `Asked Plex to analyse "${problem.title}". It clears after the next media sync.` };
      }
      default:
        throw new ProblemFixError(`"${problem.title}" has no automatic fix.`);
    }
  }

  /**
   * Fix every open problem of one kind — or just the `subjects` given, for a
   * selection on the page — one at a time.
   *
   * Sequential on purpose: each is a Plex write followed by a refresh, and a
   * library's worth in parallel is a good way to make Plex unresponsive for
   * the people watching it. One failure doesn't stop the rest.
   */
  async function fixAll(
    kind: ProblemKind,
    subjects?: readonly string[],
  ): Promise<{ fixed: number; failed: Array<{ title: string; error: string }> }> {
    const only = subjects ? new Set(subjects) : null;
    const targets = list().problems.filter(
      (p) => p.kind === kind && p.fixable && !p.dismissed && !p.fixPending && (!only || only.has(p.subject)),
    );
    let fixed = 0;
    const failed: Array<{ title: string; error: string }> = [];
    for (const p of targets) {
      try {
        await fix(p.kind, p.subject);
        fixed++;
      } catch (err) {
        failed.push({ title: p.title, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { fixed, failed };
  }

  /**
   * Dismiss several problems at once.
   *
   * One `list()` for the whole batch, not one per target: every lookup re-runs
   * every provider, and the Problems page dismisses a page of advisories at a
   * time — a hundred lookups was a hundred full detections. A target that is
   * no longer reported is skipped rather than failing the rest; it has already
   * gone, which is what dismissing it wanted.
   */
  function dismissMany(targets: ProblemTarget[]): { dismissed: number; skipped: ProblemTarget[] } {
    const current = new Map(list().problems.map((p) => [key(p.kind, p.subject), p]));
    const found: ProblemView[] = [];
    const skipped: ProblemTarget[] = [];
    for (const t of targets) {
      const problem = current.get(key(t.kind, t.subject));
      if (problem) found.push(problem);
      else skipped.push(t);
    }
    const at = deps.now();
    db.transaction((tx) => {
      for (const p of found) {
        const values = { fingerprint: p.fingerprint, title: p.title, dismissedAt: at };
        tx.insert(problemDismissals)
          .values({ kind: p.kind, subject: p.subject, ...values })
          .onConflictDoUpdate({ target: [problemDismissals.kind, problemDismissals.subject], set: values })
          .run();
      }
    });
    cachedCount = null;
    for (const p of found) {
      deps.recordChange({
        entity: "problem_dismissal",
        entityId: key(p.kind, p.subject),
        action: "create",
        after: { kind: p.kind, subject: p.subject, title: p.title, detail: p.detail },
      });
    }
    return { dismissed: found.length, skipped };
  }

  function dismiss(kind: ProblemKind, subject: string): void {
    if (dismissMany([{ kind, subject }]).dismissed === 0) {
      throw new ProblemFixError("That problem is no longer reported.");
    }
  }

  function undismissMany(targets: ProblemTarget[]): { restored: number } {
    const wanted = new Set(targets.map((t) => key(t.kind, t.subject)));
    const rows = db
      .select()
      .from(problemDismissals)
      .all()
      .filter((d) => wanted.has(key(d.kind, d.subject)));
    if (rows.length === 0) return { restored: 0 };
    db.transaction((tx) => {
      for (const row of rows) tx.delete(problemDismissals).where(eq(problemDismissals.id, row.id)).run();
    });
    cachedCount = null;
    for (const row of rows) {
      deps.recordChange({
        entity: "problem_dismissal",
        entityId: key(row.kind, row.subject),
        action: "delete",
        before: { kind: row.kind, subject: row.subject, title: row.title },
      });
    }
    return { restored: rows.length };
  }

  function undismiss(kind: ProblemKind, subject: string): void {
    undismissMany([{ kind, subject }]);
  }

  /**
   * Tell the notification channels about faults no earlier scan announced.
   *
   * The announced set is replaced with what is open now, so a problem that is
   * fixed and later comes back is announced again — it is news again.
   */
  function announceNew(): string[] {
    const open = openFaults();
    const before = new Set(deps.config.getConfig("problems_announced") ?? []);
    const fresh = open.filter((p) => !before.has(key(p.kind, p.subject)));
    deps.config.setConfig(
      "problems_announced",
      open.map((p) => key(p.kind, p.subject)),
    );
    if (fresh.length > 0) {
      const names = fresh.slice(0, 3).map((p) => `${p.title} (${PROBLEM_META[p.kind].label.toLowerCase()})`);
      const rest = fresh.length > 3 ? ` and ${fresh.length - 3} more` : "";
      deps.emitEvent(
        "problems.found",
        `${fresh.length} new problem${fresh.length === 1 ? "" : "s"}: ${names.join(", ")}${rest}`,
        { count: fresh.length, kinds: [...new Set(fresh.map((p) => p.kind))] },
      );
    }
    cachedCount = null;
    return fresh.map((p) => key(p.kind, p.subject));
  }

  /** Make the next scan look at one show again. */
  function recheck(subject: string): void {
    scan.markStale(ratingKeyOf(subject));
  }

  return {
    list,
    openCount,
    fix,
    fixAll,
    dismiss,
    dismissMany,
    undismiss,
    undismissMany,
    announceNew,
    recheck,
    scanShows: scan.scanShows,
  };
}

export type Problems = ReturnType<typeof createProblems>;

export const ProblemsToken = token<Problems>("problems");

export type { Problem } from "./providers.ts";
export type { OrderingEvidence } from "./ordering.ts";
export type { ScanResult } from "./scan.ts";
