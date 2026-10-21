import { useMemo, useState } from "react";
import { PROBLEM_META } from "@rube/contracts";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import ListRow from "#components/list/ListRow";
import ListSection from "#components/list/ListSection";
import { SkeletonTable } from "#components/Skeleton";
import controls from "#/styles/controls.module.css";
import { summariseKinds, type KindSummary } from "./problemsView.ts";
import { ScannedLine } from "./ScannedLine.tsx";
import { useProblemActions, useProblems } from "./useProblemActions.ts";
import styles from "./Problems.module.css";

/**
 * What needs doing, across Plex, the *Arrs and your rules — one row per kind.
 *
 * This page used to be every kind's full table stacked in one scroll. With a
 * few hundred deliberately unmanaged films, "In Plex, not managed" alone
 * pushed every fault off the screen, so the overview is now a short list of
 * kinds — faults first, each with its count — and a kind opens on its own
 * page (`ProblemKind`) to be searched, paged and acted on in bulk.
 */
export default function Problems() {
  const { query, problems, lastScannedAt } = useProblems();
  const { rescan } = useProblemActions();
  const [showDismissed, setShowDismissed] = useState(false);

  const summary = useMemo(() => summariseKinds(problems), [problems]);

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

  const open = summary.reduce((n, s) => n + s.open, 0);
  const faults = summary.filter((s) => s.severity === "fault").reduce((n, s) => n + s.open, 0);
  const dismissedCount = summary.reduce((n, s) => n + s.dismissed, 0);
  // Without "show dismissed", a kind that is entirely dismissed drops out of
  // the overview, the way its rows dropped out of the old single page.
  const visible = summary.filter((s) => s.open > 0 || showDismissed);

  const actions = (
    <>
      {dismissedCount > 0 && (
        <button
          type="button"
          className={`${controls.btn} ${controls.btnGhost}`}
          aria-pressed={showDismissed}
          onClick={() => setShowDismissed((v) => !v)}
        >
          {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissedCount})`}
        </button>
      )}
      <button
        type="button"
        className={`${controls.btn} ${controls.btnSecondary}`}
        disabled={rescan.isPending}
        onClick={() => rescan.mutate()}
      >
        Scan now
      </button>
    </>
  );

  if (visible.length === 0) {
    return (
      <PageShell actions={actions}>
        <ScannedLine lastScannedAt={lastScannedAt} />
        <EmptyState
          icon="list"
          title="No problems"
          description="Plex, your *Arrs and your rules agree with each other."
        />
      </PageShell>
    );
  }

  const faultRows = visible.filter((s) => s.severity === "fault");
  const advisoryRows = visible.filter((s) => s.severity === "advisory");

  return (
    <PageShell
      count={String(open)}
      chip={
        faults > 0 ? (
          <StatusChip tone="error">{faults} needing attention</StatusChip>
        ) : (
          <StatusChip tone="ok">Nothing broken</StatusChip>
        )
      }
      actions={actions}
    >
      <ScannedLine lastScannedAt={lastScannedAt} />
      <div className={styles.sections}>
        {faultRows.length > 0 && (
          <ListSection title="Needing attention">
            {faultRows.map((s) => (
              <KindRow key={s.kind} summary={s} showDismissed={showDismissed} />
            ))}
          </ListSection>
        )}
        {advisoryRows.length > 0 && (
          <ListSection
            title="For information"
            footer="Often intended. These don't count towards the badge in the sidebar."
          >
            {advisoryRows.map((s) => (
              <KindRow key={s.kind} summary={s} showDismissed={showDismissed} />
            ))}
          </ListSection>
        )}
      </div>
    </PageShell>
  );
}

function KindRow({ summary, showDismissed }: { summary: KindSummary; showDismissed: boolean }) {
  const meta = PROBLEM_META[summary.kind];
  return (
    <ListRow
      to={`/problems/${summary.kind}${summary.open === 0 ? "?show=dismissed" : ""}`}
      title={meta.label}
      subtitle={meta.explanation}
      value={
        <>
          <span className={styles.count}>{summary.open.toLocaleString()}</span>
          {showDismissed && summary.dismissed > 0 && (
            <span className={styles.dismissedCount}> · {summary.dismissed.toLocaleString()} dismissed</span>
          )}
        </>
      }
    />
  );
}
