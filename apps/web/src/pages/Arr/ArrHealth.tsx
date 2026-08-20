import { Link } from "react-router-dom";
import { ARR_ISSUE_LABELS, type ArrIssueKind } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import { SkeletonTable } from "#components/Skeleton";
import shared from "#/styles/shared.module.css";
import styles from "./ArrHealth.module.css";

/**
 * What is wrong across the whole stack.
 *
 * The page that only Tinkerbell can show. Radarr cannot tell you whether a
 * film reached Plex, and Plex cannot tell you whether anything is monitoring
 * it; each of these findings is a join across the two that neither application
 * can perform on its own.
 */

/** Which findings are faults and which are merely observations. */
const ADVISORY: ReadonlySet<ArrIssueKind> = new Set(["inPlexNotInArr", "duplicateAcrossInstances"]);

const EXPLANATIONS: Record<ArrIssueKind, string> = {
  inArrNotInPlex:
    "The *Arr has the file on disk, but no Plex item matches it. Usually a library that has not been scanned, or a folder Plex is not watching.",
  inPlexNotInArr:
    "Plex holds these, but no Radarr or Sonarr is managing them. Not necessarily wrong — plenty of libraries hold things nobody wants automated.",
  duplicateAcrossInstances:
    "Held by more than one instance, both with files. On a deliberate 1080p/4K split that is the intent; otherwise it is disk being spent twice.",
  stuckInQueue: "In the queue but not making progress.",
  failedImport: "Grabbed, but never imported. The download finished and something stopped it becoming a file.",
  settingsDrift: "Instances of the same service disagree about their configuration.",
};

export default function ArrHealth() {
  const query = trpc.arr.library.issues.useQuery();

  if (query.isPending) {
    return (
      <PageShell>
        <SkeletonTable rows={6} columns={2} />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell>
        <ErrorState title="Couldn't run the checks" error={query.error} onRetry={() => query.refetch()} />
      </PageShell>
    );
  }

  const issues = query.data ?? [];
  const grouped = new Map<ArrIssueKind, typeof issues>();
  for (const issue of issues) {
    const list = grouped.get(issue.kind) ?? [];
    list.push(issue);
    grouped.set(issue.kind, list);
  }

  const faults = issues.filter((i) => !ADVISORY.has(i.kind)).length;

  if (issues.length === 0) {
    return (
      <PageShell>
        <EmptyState
          icon="list"
          title="Nothing to reconcile"
          description="Every managed title with a file has a matching Plex item, and nothing was grabbed without being imported."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      count={String(issues.length)}
      chip={
        faults > 0 ? (
          <StatusChip tone="error">{faults} needing attention</StatusChip>
        ) : (
          <StatusChip tone="ok">Nothing broken</StatusChip>
        )
      }
    >
      {[...grouped.entries()].map(([kind, rows]) => (
        <section key={kind} className={styles.group}>
          <header className={styles.groupHead}>
            <h3 className={styles.groupTitle}>{ARR_ISSUE_LABELS[kind]}</h3>
            <span className={styles.groupCount}>{rows.length}</span>
            {ADVISORY.has(kind) && <StatusChip tone="advisory">For information</StatusChip>}
          </header>
          <p className={styles.explanation}>{EXPLANATIONS[kind]}</p>

          <table className={shared.compactTable}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((issue, i) => (
                <tr key={`${kind}-${issue.instanceId}-${issue.arrId ?? issue.ratingKey ?? i}`}>
                  <td>
                    {issue.ratingKey ? (
                      <Link className={shared.cellLink} to={`/media/${issue.ratingKey}`}>
                        {issue.title}
                      </Link>
                    ) : (
                      issue.title
                    )}
                  </td>
                  <td className={shared.cellMuted}>{issue.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </PageShell>
  );
}
