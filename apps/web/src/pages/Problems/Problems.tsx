import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, EyeOff, ExternalLink, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { PROBLEM_KINDS, PROBLEM_META, type ProblemKind } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import RowActions, { type RowAction } from "#components/RowActions";
import { SkeletonTable } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import styles from "./Problems.module.css";

/**
 * What needs doing, across Plex, the *Arrs and your rules.
 *
 * Grouped by kind, faults before advisories, each kind with the sentence that
 * says why it matters — a list of titles alone gives nobody a reason to act.
 * Fixes run only from here, one button at a time, because every one of them
 * changes Plex.
 */

type ProblemRow = ReturnType<typeof useProblems>["problems"][number];

function useProblems() {
  const query = trpc.problems.list.useQuery();
  return { query, problems: query.data?.problems ?? [], lastScannedAt: query.data?.lastScannedAt ?? null };
}

/** Kinds that come from the episode scan, and so can be re-checked one show at a time. */
const SCANNED: ReadonlySet<ProblemKind> = new Set(["episodeOrdering", "missingEpisodes"]);

function OrderingEvidence({ problem }: { problem: ProblemRow }) {
  const evidence = problem.evidence;
  if (!evidence || evidence.examples.length === 0) return null;
  return (
    <details className={styles.evidence}>
      <summary>
        Example episodes
        {evidence.multiEpisodeFiles > 0 &&
          ` · ${evidence.multiEpisodeFiles} multi-episode file${evidence.multiEpisodeFiles === 1 ? "" : "s"}`}
      </summary>
      <table className={`${shared.table} ${shared.compactTable}`}>
        <thead>
          <tr>
            <th>Episode</th>
            <th>Plex calls it</th>
            <th>Sonarr calls it</th>
          </tr>
        </thead>
        <tbody>
          {evidence.examples.map((e) => (
            <tr key={e.code}>
              <td className={shared.cellMuted}>{e.code}</td>
              <td>{e.plex}</td>
              <td>{e.sonarr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default function Problems() {
  const { query, problems, lastScannedAt } = useProblems();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void utils.problems.list.invalidate();
    void utils.nav.metrics.invalidate();
  };
  const onError = (err: { message: string }) => addToast(err.message, "error");

  const fix = trpc.problems.fix.useMutation({
    onSuccess: (r) => addToast(r.message, "success"),
    onError,
    onSettled: () => {
      setBusy(null);
      refresh();
    },
  });
  const fixAll = trpc.problems.fixAll.useMutation({
    onSuccess: (r) => {
      addToast(`Fixed ${r.fixed}.`, "success");
      for (const f of r.failed) addToast(`${f.title}: ${f.error}`, "error");
    },
    onError,
    onSettled: () => {
      setBusy(null);
      refresh();
    },
  });
  const dismiss = trpc.problems.dismiss.useMutation({ onError, onSettled: refresh });
  const undismiss = trpc.problems.undismiss.useMutation({ onError, onSettled: refresh });
  const rescan = trpc.problems.rescan.useMutation({
    onSuccess: (r) =>
      addToast(r.ok ? "Scanning — results appear here as it finishes." : "A scan is already running.", "info"),
    onError,
  });

  const visible = useMemo(() => problems.filter((p) => showDismissed || !p.dismissed), [problems, showDismissed]);
  const grouped = useMemo(() => {
    const byKind = new Map<ProblemKind, ProblemRow[]>();
    for (const p of visible) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    // Faults first, then advisories, each in the contract's order.
    return [...PROBLEM_KINDS]
      .sort((a, b) => Number(PROBLEM_META[a].severity === "advisory") - Number(PROBLEM_META[b].severity === "advisory"))
      .filter((k) => byKind.has(k))
      .map((k) => [k, byKind.get(k) ?? []] as const);
  }, [visible]);

  if (query.isPending) {
    return (
      <PageShell>
        <SkeletonTable rows={6} columns={3} />
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

  const open = problems.filter((p) => !p.dismissed);
  const faults = open.filter((p) => PROBLEM_META[p.kind].severity === "fault").length;
  const dismissedCount = problems.length - open.length;

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

  const scannedLine = (
    <p className={styles.scanned}>
      {lastScannedAt ? (
        <>
          Episodes last compared <RelativeTime timestamp={lastScannedAt} />. Everything else is checked as you open this
          page.
        </>
      ) : (
        <>Episodes haven't been compared with Sonarr yet. The scan runs nightly, or now with Scan now.</>
      )}
    </p>
  );

  if (visible.length === 0) {
    return (
      <PageShell actions={actions}>
        {scannedLine}
        <EmptyState
          icon="list"
          title="No problems"
          description="Plex, your *Arrs and your rules agree with each other."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      count={String(open.length)}
      chip={
        faults > 0 ? (
          <StatusChip tone="error">{faults} needing attention</StatusChip>
        ) : (
          <StatusChip tone="ok">Nothing broken</StatusChip>
        )
      }
      actions={actions}
    >
      {scannedLine}
      {grouped.map(([kind, rows]) => {
        const meta = PROBLEM_META[kind];
        const fixableOpen = rows.filter((p) => p.fixable && !p.dismissed && !p.fixPending);
        return (
          <section key={kind} className={styles.group}>
            <header className={styles.groupHead}>
              <h3 className={styles.groupTitle}>{meta.label}</h3>
              <span className={styles.groupCount}>{rows.length}</span>
              {meta.severity === "advisory" && <StatusChip tone="advisory">For information</StatusChip>}
              {fixableOpen.length > 1 && (
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm} ${styles.fixAll}`}
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(`all:${kind}`);
                    fixAll.mutate({ kind });
                  }}
                >
                  {busy === `all:${kind}` ? "Fixing…" : `${meta.fixLabel ?? "Fix"} all ${fixableOpen.length}`}
                </button>
              )}
            </header>
            <p className={styles.explanation}>{meta.explanation}</p>

            <div className="table-scroll">
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Detail</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const id = `${p.kind}:${p.subject}`;
                    const rowActions: RowAction[] = [];
                    if (p.fixable && !p.dismissed) {
                      rowActions.push({
                        label: busy === id ? "Fixing…" : (p.fixLabel ?? meta.fixLabel ?? "Fix"),
                        icon: Wrench,
                        inline: true,
                        primary: true,
                        disabled: busy !== null || p.fixPending,
                        onSelect: () => {
                          setBusy(id);
                          fix.mutate({ kind: p.kind, subject: p.subject });
                        },
                      });
                    }
                    if (p.link) {
                      const to = p.link;
                      rowActions.push({ label: "Open", icon: ExternalLink, onSelect: () => navigate(to) });
                    }
                    if (SCANNED.has(p.kind)) {
                      rowActions.push({
                        label: "Check again",
                        icon: RefreshCw,
                        onSelect: () => rescan.mutate({ subject: p.subject }),
                      });
                    }
                    rowActions.push(
                      p.dismissed
                        ? {
                            label: "Restore",
                            icon: RotateCcw,
                            onSelect: () => undismiss.mutate({ kind: p.kind, subject: p.subject }),
                          }
                        : {
                            label: "Dismiss",
                            icon: EyeOff,
                            onSelect: () => dismiss.mutate({ kind: p.kind, subject: p.subject }),
                          },
                    );
                    return (
                      <tr key={id} className={p.dismissed ? styles.dismissed : undefined}>
                        <td data-cell="title">
                          {p.link ? (
                            <Link className={shared.cellLink} to={p.link}>
                              {p.title}
                            </Link>
                          ) : (
                            p.title
                          )}
                        </td>
                        <td data-cell="meta">
                          <span className={shared.cellMuted}>{p.detail}</span>
                          {p.fixPending && (
                            <span className={styles.pending}>
                              <Check size={14} aria-hidden="true" /> Fix applied — waiting for the next scan to confirm
                            </span>
                          )}
                          {p.kind === "episodeOrdering" && <OrderingEvidence problem={p} />}
                        </td>
                        <td data-cell="hide" className={styles.actionsCell}>
                          <RowActions label={`Actions for ${p.title}`} actions={rowActions} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </PageShell>
  );
}
