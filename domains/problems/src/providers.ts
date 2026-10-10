/**
 * Where each kind of problem comes from.
 *
 * Every kind but two is a query over tables that already exist, run when
 * asked — the reconciliation module's rule that a stored issue list is one
 * more thing that can be stale and wrong. The two that aren't, episode
 * ordering and missing episodes, read `show_checks`, which the scan writes;
 * they are only as fresh as the last scan, and the page says when that was.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, like, notLike, or, sql } from "drizzle-orm";
import { mediaItems, ruleRuns, rules, showChecks, type Db } from "@tinkerbell/db";
import type { ProblemKind } from "@tinkerbell/contracts";
import type { ArrInstance } from "@tinkerbell/core";
import type { ArrIssue, ArrLibrary } from "@tinkerbell/domain.arr-library";
import type { RuleConflict } from "@tinkerbell/domain.rules";
import { isTvdbOrdering } from "@tinkerbell/plex";
import type { OrderingEvidence } from "./ordering.ts";

export interface Problem {
  kind: ProblemKind;
  /** Stable across scans: what the problem is *about* — a show, an item, a rule. */
  subject: string;
  title: string;
  detail: string;
  /** Where in the app to look at the subject. */
  link?: string;
  fixable: boolean;
  /** Overrides the kind's own Fix label, where this one needs a different action. */
  fixLabel?: string;
  /** The episode comparison, for ordering problems. */
  evidence?: OrderingEvidence;
  /** A fix has been applied and no scan has looked since. */
  fixPending?: boolean;
  /** A digest of the evidence. A dismissal holds only while this is unchanged. */
  fingerprint: string;
}

export type ArrReconcile = Pick<
  ArrLibrary,
  "inArrNotInPlex" | "inPlexNotInArr" | "duplicateAcrossInstances" | "failedImports"
>;

export interface ProvidersDeps {
  db: Db;
  reconcile: ArrReconcile;
  ruleConflicts: () => RuleConflict[];
  arrInstances: () => ArrInstance[];
}

/** Same cap per kind as reconciliation: one pathological library must not produce 40k rows. */
const PER_KIND_LIMIT = 200;

export function fingerprintOf(...parts: unknown[]): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}

const ORDERING_LABELS: Record<string, string> = {
  tmdbAiring: "The Movie Database",
  tvdbAiring: "TheTVDB (Aired)",
  tvdbDvd: "TheTVDB (DVD)",
  tvdbAbsolute: "TheTVDB (Absolute)",
};

function orderingLabel(ordering: string | null): string {
  if (!ordering) return "its library's default ordering";
  return ORDERING_LABELS[ordering] ?? ordering;
}

function isLegacyAgent(guid: string | null): boolean {
  return guid?.startsWith("com.plexapp.agents.") ?? false;
}

function listCodes(codes: string[], max = 5): string {
  const head = codes.slice(0, max).join(", ");
  return codes.length > max ? `${head} and ${codes.length - max} more` : head;
}

export function createProviders(deps: ProvidersDeps) {
  const { db } = deps;

  function showRows() {
    return db
      .select({
        ratingKey: showChecks.plexRatingKey,
        title: showChecks.title,
        ordering: showChecks.ordering,
        orderingEvidence: showChecks.orderingEvidence,
        missingEpisodes: showChecks.missingEpisodes,
        plexFolder: showChecks.plexFolder,
        checkedAt: showChecks.checkedAt,
        fixedAt: showChecks.fixedAt,
        agentGuid: mediaItems.agentGuid,
      })
      .from(showChecks)
      .leftJoin(mediaItems, eq(mediaItems.ratingKey, showChecks.plexRatingKey))
      .where(or(isNotNull(showChecks.orderingEvidence), isNotNull(showChecks.missingEpisodes)))
      .orderBy(showChecks.title)
      .all();
  }

  /**
   * One problem per Plex show, even when two Sonarr instances link to it —
   * the fix is to the show, and two rows would offer to apply it twice.
   */
  function showProblems(): Problem[] {
    const out: Problem[] = [];
    const seen = new Set<string>();
    for (const row of showRows()) {
      const pending = row.fixedAt != null && row.fixedAt >= row.checkedAt;
      const evidence = row.orderingEvidence as OrderingEvidence | null;

      if (evidence && !seen.has(`o:${row.ratingKey}`)) {
        seen.add(`o:${row.ratingKey}`);
        const seasons = evidence.seasons.map((s) => `season ${s.season} (${s.mismatched} of ${s.compared})`).join(", ");
        const legacy = isLegacyAgent(row.agentGuid);
        const alreadyTvdb = isTvdbOrdering(row.ordering);
        out.push({
          kind: "episodeOrdering",
          subject: `plex:${row.ratingKey}`,
          title: row.title,
          detail: legacy
            ? `Titles disagree in ${seasons}. The show is on a legacy agent, which ignores episode ordering.`
            : alreadyTvdb
              ? `Titles disagree in ${seasons}, though the show is already on ${orderingLabel(row.ordering)}. Plex may not have refreshed it since.`
              : `Titles disagree in ${seasons}. Plex is on ${orderingLabel(row.ordering)}; Sonarr names files by TheTVDB.`,
          link: `/media/${row.ratingKey}`,
          fixable: !legacy,
          ...(alreadyTvdb ? { fixLabel: "Refresh metadata" } : {}),
          evidence,
          fixPending: pending,
          fingerprint: fingerprintOf(evidence.seasons.map((s) => s.season)),
        });
      }

      const missing = row.missingEpisodes ?? [];
      if (missing.length > 0 && !seen.has(`m:${row.ratingKey}`)) {
        seen.add(`m:${row.ratingKey}`);
        out.push({
          kind: "missingEpisodes",
          subject: `plex:${row.ratingKey}`,
          title: row.title,
          detail: `Plex doesn't list ${listCodes(missing)}.`,
          link: `/media/${row.ratingKey}`,
          fixable: row.plexFolder != null,
          fixPending: pending,
          fingerprint: fingerprintOf(missing),
        });
      }
    }
    return out;
  }

  function arrProblems(): Problem[] {
    const serviceOf = new Map(deps.arrInstances().map((i) => [i.id, i.service]));
    const arrLink = (issue: ArrIssue) => {
      const service = issue.service ?? serviceOf.get(issue.instanceId);
      if (issue.ratingKey) return `/media/${issue.ratingKey}`;
      if (!service || issue.arrId == null) return undefined;
      return `/arrs/${issue.instanceId}/${service === "radarr" ? "movies" : "series"}/${issue.arrId}`;
    };
    const issues = [
      ...deps.reconcile.inArrNotInPlex(),
      ...deps.reconcile.failedImports(),
      ...deps.reconcile.inPlexNotInArr(),
      ...deps.reconcile.duplicateAcrossInstances(),
    ];
    return issues.map((issue) => ({
      kind: issue.kind,
      subject: issue.ratingKey
        ? `plex:${issue.ratingKey}`
        : issue.arrId != null
          ? `${issue.instanceId}:${issue.arrId}`
          : `title:${issue.title}`,
      title: issue.title,
      detail: issue.detail,
      link: arrLink(issue),
      fixable: false,
      fingerprint: fingerprintOf(issue.detail),
    }));
  }

  /**
   * Shows with episodes Plex gave no size for.
   *
   * Shows only. The media sync counts unsized episodes explicitly, so a
   * positive number is a measurement; a film's null `file_size` is not — it is
   * also what every film looks like on an install that last synced before
   * sizes were stored, and reporting it put an entire 4,000-film library on
   * this page.
   */
  function unknownSizeProblems(): Problem[] {
    const rows = db
      .select({
        ratingKey: mediaItems.ratingKey,
        title: mediaItems.title,
        unsized: mediaItems.sizeUnknownParts,
        leafCount: mediaItems.leafCount,
      })
      .from(mediaItems)
      .where(and(eq(mediaItems.type, "show"), sql`${mediaItems.sizeUnknownParts} > 0`))
      .orderBy(mediaItems.title)
      .limit(PER_KIND_LIMIT)
      .all();
    return rows.map((r) => ({
      kind: "unknownSize" as const,
      subject: `plex:${r.ratingKey}`,
      title: r.title,
      detail: `${r.unsized} of ${r.leafCount ?? "its"} episodes have no size in Plex.`,
      link: `/media/${r.ratingKey}`,
      fixable: true,
      fingerprint: fingerprintOf(r.unsized ?? 0),
    }));
  }

  /**
   * Items on a retired agent, and items no agent matched.
   *
   * `com.plexapp.agents.none` is the "Personal Media" agent — chosen on
   * purpose for home videos, and not a problem to anyone who chose it.
   */
  function agentProblems(): Problem[] {
    const legacy = db
      .select({ ratingKey: mediaItems.ratingKey, title: mediaItems.title, guid: mediaItems.agentGuid })
      .from(mediaItems)
      .where(
        and(
          like(mediaItems.agentGuid, "com.plexapp.agents.%"),
          notLike(mediaItems.agentGuid, "com.plexapp.agents.none%"),
        ),
      )
      .orderBy(mediaItems.title)
      .limit(PER_KIND_LIMIT)
      .all();
    const unmatched = db
      .select({ ratingKey: mediaItems.ratingKey, title: mediaItems.title })
      .from(mediaItems)
      .where(like(mediaItems.agentGuid, "local://%"))
      .orderBy(mediaItems.title)
      .limit(PER_KIND_LIMIT)
      .all();
    return [
      ...legacy.map((r) => ({
        kind: "legacyAgent" as const,
        subject: `plex:${r.ratingKey}`,
        title: r.title,
        detail: `Matched by ${(r.guid ?? "").replace(/^com\.plexapp\.agents\.([^:]+).*/, "$1")}.`,
        link: `/media/${r.ratingKey}`,
        fixable: false,
        fingerprint: fingerprintOf("legacy"),
      })),
      ...unmatched.map((r) => ({
        kind: "unmatched" as const,
        subject: `plex:${r.ratingKey}`,
        title: r.title,
        detail: "No IMDb, TMDb or TVDB id.",
        link: `/media/${r.ratingKey}`,
        fixable: false,
        fingerprint: fingerprintOf("unmatched"),
      })),
    ];
  }

  /**
   * Enabled rules whose last real run failed, or matched nothing after a run
   * that matched something — the same transition `rule.empty` announces.
   *
   * Two reads per rule. Rules number in the dozens, and the index on
   * `(rule_id, started_at)` makes each one a seek.
   */
  function ruleProblems(): Problem[] {
    const enabled = db.select({ id: rules.id, name: rules.name }).from(rules).where(eq(rules.enabled, 1)).all();
    const out: Problem[] = [];
    for (const rule of enabled) {
      const runs = db
        .select({ id: ruleRuns.id, status: ruleRuns.status, itemCount: ruleRuns.itemCount, error: ruleRuns.error })
        .from(ruleRuns)
        .where(and(eq(ruleRuns.ruleId, rule.id), eq(ruleRuns.phase, "run"), inArray(ruleRuns.status, ["ok", "error"])))
        .orderBy(desc(ruleRuns.startedAt))
        .limit(2)
        .all();
      const [last, before] = runs;
      if (!last) continue;
      const link = `/rules/${encodeURIComponent(rule.id)}/runs?run=${encodeURIComponent(last.id)}`;
      if (last.status === "error") {
        out.push({
          kind: "ruleFailing",
          subject: `rule:${rule.id}`,
          title: rule.name,
          detail: last.error ? `Last run failed: ${last.error}` : "Last run failed.",
          link,
          fixable: false,
          fingerprint: fingerprintOf(last.error ?? ""),
        });
      } else if (last.itemCount === 0 && before?.status === "ok" && (before.itemCount ?? 0) > 0) {
        out.push({
          kind: "ruleEmpty",
          subject: `rule:${rule.id}`,
          title: rule.name,
          detail: `Matched nothing on its last run, having matched ${before.itemCount} the run before.`,
          link,
          fixable: false,
          // The run that last matched something: if the rule recovers and then
          // empties again, that is a new occurrence and should come back.
          fingerprint: fingerprintOf(before.id),
        });
      }
    }
    return out;
  }

  function conflictProblems(): Problem[] {
    return deps.ruleConflicts().map((c) => ({
      kind: "ruleConflict" as const,
      subject: `${c.kind}:${c.library?.key ?? ""}:${c.subject}`,
      title: c.rules.map((r) => r.name).join(" and "),
      detail: c.detail,
      link: `/rules?q=${encodeURIComponent(c.rules[0]?.name ?? "")}`,
      fixable: false,
      fingerprint: fingerprintOf(c.rules.map((r) => r.id).sort()),
    }));
  }

  /** Every problem, in the order the page lists kinds. */
  function detectAll(): Problem[] {
    return [
      ...showProblems(),
      ...arrProblems(),
      ...unknownSizeProblems(),
      ...ruleProblems(),
      ...conflictProblems(),
      ...agentProblems(),
    ];
  }

  return { detectAll, showRows };
}
