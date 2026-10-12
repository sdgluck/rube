import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, EyeOff, ExternalLink, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { isProblemKind, PROBLEM_META, type ProblemKind as Kind } from "@tinkerbell/contracts";
import PageShell, { StatusChip } from "#components/PageShell";
import BulkBar, { type BulkAction } from "#components/BulkBar";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import Pagination from "#components/Pagination";
import RowActions, { type RowAction } from "#components/RowActions";
import SearchInput from "#components/SearchInput";
import SortableTh from "#components/SortableTh";
import { SkeletonTable } from "#components/Skeleton";
import { useListParams } from "#hooks/useListParams";
import { PageCrumbs } from "#layout/AppBar";
import { readEnum } from "#/storage";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import { filterKindRows, isFixableOpen, SHOW_FILTERS, type ShowFilter } from "./problemsView.ts";
import { ScannedLine } from "./ScannedLine.tsx";
import { useProblemActions, useProblems, type ProblemRow } from "./useProblemActions.ts";
import styles from "./ProblemKind.module.css";

/**
 * One kind of problem, on its own page: searched, paged, and acted on a page
 * of rows at a time.
 *
 * The overview used to be this table for every kind at once. Splitting it
 * out is what makes a few hundred advisories manageable — and bulk Dismiss is
 * what makes them clearable, where the old page took one ⋯ menu per row.
 */

const PAGE_SIZE = 50;
const SORT_KEYS = ["title", "detail"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SHOW_LABELS: Record<ShowFilter, string> = { open: "Open", dismissed: "Dismissed", all: "All" };

/** Kinds that come from the episode scan, and so can be re-checked one show at a time. */
const SCANNED: ReadonlySet<Kind> = new Set(["episodeOrdering", "missingEpisodes"]);

export default function ProblemKindPage() {
  const { kind } = useParams();
  if (!kind || !isProblemKind(kind)) return <Navigate to="/problems" replace />;
  // Keyed so the selection, and anything else local, starts over per kind.
  return <KindView key={kind} kind={kind} />;
}

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

function KindView({ kind }: { kind: Kind }) {
  const meta = PROBLEM_META[kind];
  const navigate = useNavigate();
  const { query, problems, lastScannedAt } = useProblems();
  const { busy, setBusy, fix, fixAll, dismiss, undismiss, dismissMany, undismissMany, rescan } = useProblemActions();
  const { sortKey, sortDir, page, param, setParam, setParams, setPage, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
  });
  const q = param("q");
  const show = readEnum(param("show") || null, SHOW_FILTERS, "open");

  const ofKind = useMemo(() => problems.filter((p) => p.kind === kind), [problems, kind]);
  const rows = useMemo(() => {
    const filtered = filterKindRows(ofKind, kind, { q, show });
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort(
      (a, b) => dir * a[sortKey].localeCompare(b[sortKey], undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [ofKind, kind, q, show, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Selection belongs to the view it was made in: a new search, filter or page
  // starts empty rather than carrying rows the person can no longer see into
  // a bulk Dismiss. Rows that left the list (fixed, dismissed) drop out too.
  const scope = `${q}|${show}|${currentPage}|${sortKey}|${sortDir}`;
  const [selection, setSelection] = useState<{ scope: string; subjects: Set<string> }>({
    scope,
    subjects: new Set(),
  });
  const selected = pageRows.filter((p) => selection.scope === scope && selection.subjects.has(p.subject));
  const selectedSubjects = new Set(selected.map((p) => p.subject));
  const setSelected = (subjects: Set<string>) => setSelection({ scope, subjects });
  const clearSelection = () => setSelected(new Set());
  const toggle = (subject: string) => {
    const next = new Set(selectedSubjects);
    if (next.has(subject)) next.delete(subject);
    else next.add(subject);
    setSelected(next);
  };
  const allSelected = pageRows.length > 0 && selected.length === pageRows.length;

  if (query.isPending) {
    return (
      <PageShell>
        <PageCrumbs crumbs={[{ label: meta.label }]} />
        <SkeletonTable rows={8} columns={3} />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell>
        <PageCrumbs crumbs={[{ label: meta.label }]} />
        <ErrorState title="Couldn't run the checks" error={query.error} onRetry={() => query.refetch()} />
      </PageShell>
    );
  }

  const openCount = ofKind.filter((p) => !p.dismissed).length;
  const dismissedCount = ofKind.length - openCount;
  const fixableOpen = ofKind.filter(isFixableOpen);
  const target = (p: ProblemRow) => ({ kind: p.kind, subject: p.subject });

  const selectedFixable = selected.filter(isFixableOpen);
  const selectedOpen = selected.filter((p) => !p.dismissed);
  const selectedDismissed = selected.filter((p) => p.dismissed);
  const bulkActions: BulkAction[] = [];
  if (ofKind.some((p) => p.fixable)) {
    bulkActions.push({
      label: busy === "bulk" ? "Fixing…" : `${meta.fixLabel ?? "Fix"} ${selectedFixable.length}`,
      tone: "primary",
      disabled: selectedFixable.length === 0 || busy !== null,
      onClick: () => {
        setBusy("bulk");
        fixAll.mutate({ kind, subjects: selectedFixable.map((p) => p.subject) }, { onSuccess: clearSelection });
      },
    });
  }
  if (selectedOpen.length > 0) {
    bulkActions.push({
      label: `Dismiss ${selectedOpen.length}`,
      disabled: dismissMany.isPending,
      onClick: () => dismissMany.mutate({ targets: selectedOpen.map(target) }, { onSuccess: clearSelection }),
    });
  }
  if (selectedDismissed.length > 0) {
    bulkActions.push({
      label: `Restore ${selectedDismissed.length}`,
      disabled: undismissMany.isPending,
      onClick: () => undismissMany.mutate({ targets: selectedDismissed.map(target) }, { onSuccess: clearSelection }),
    });
  }

  const actions = (
    <>
      {SCANNED.has(kind) && (
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary}`}
          disabled={rescan.isPending}
          onClick={() => rescan.mutate()}
        >
          Scan now
        </button>
      )}
      {fixableOpen.length > 1 && (
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          disabled={busy !== null}
          onClick={() => {
            setBusy("all");
            fixAll.mutate({ kind });
          }}
        >
          {busy === "all" ? "Fixing…" : `${meta.fixLabel ?? "Fix"} all ${fixableOpen.length}`}
        </button>
      )}
    </>
  );

  const isFiltered = q !== "" || show !== "open";

  return (
    <PageShell
      count={String(openCount)}
      chip={meta.severity === "advisory" ? <StatusChip tone="advisory">For information</StatusChip> : undefined}
      actions={actions}
    >
      <PageCrumbs crumbs={[{ label: meta.label }]} />
      <p className={styles.explanation}>{meta.explanation}</p>
      {SCANNED.has(kind) && <ScannedLine lastScannedAt={lastScannedAt} />}

      <div className={shared.filters}>
        <SearchInput
          placeholder="Search titles…"
          ariaLabel="Search these problems"
          value={q}
          onChange={(v) => setParam("q", v)}
        />
        {dismissedCount > 0 && (
          <span className={styles.segmented} role="tablist" aria-label="Show open or dismissed">
            {SHOW_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={value === show}
                className={`${styles.segmentedBtn} ${value === show ? styles.segmentedBtnActive : ""}`}
                onClick={() => setParam("show", value === "open" ? "" : value)}
              >
                {SHOW_LABELS[value]}
                {value === "dismissed" && ` (${dismissedCount})`}
              </button>
            ))}
          </span>
        )}
      </div>

      {selected.length > 0 && (
        <BulkBar count={selected.length} noun="problem" actions={bulkActions} onClear={clearSelection} />
      )}

      {rows.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon="search"
            title="No problems match"
            action={
              <button
                type="button"
                className={`${controls.btn} ${controls.btnSecondary}`}
                onClick={() => setParams({ q: "", show: "" })}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon="list"
            title="Nothing open here"
            description="Every problem of this kind has been fixed or dismissed."
            action={
              <Link className={`${controls.btn} ${controls.btnSecondary}`} to="/problems">
                All problems
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="table-scroll">
            <table className={shared.table}>
              <thead>
                <tr>
                  <th className={shared.checkboxCell}>
                    <input
                      type="checkbox"
                      className={shared.checkbox}
                      aria-label="Select every problem on this page"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(pageRows.map((p) => p.subject)))}
                    />
                  </th>
                  <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Title
                  </SortableTh>
                  <SortableTh sortKey="detail" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Detail
                  </SortableTh>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
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
                        fix.mutate(target(p));
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
                      ? { label: "Restore", icon: RotateCcw, onSelect: () => undismiss.mutate(target(p)) }
                      : { label: "Dismiss", icon: EyeOff, onSelect: () => dismiss.mutate(target(p)) },
                  );
                  const isSelected = selectedSubjects.has(p.subject);
                  const rowClass = [isSelected ? shared.selectedRow : "", p.dismissed ? styles.dismissed : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr key={id} className={rowClass || undefined}>
                      <td className={shared.checkboxCell}>
                        <input
                          type="checkbox"
                          className={shared.checkbox}
                          aria-label={`Select ${p.title}`}
                          checked={isSelected}
                          onChange={() => toggle(p.subject)}
                        />
                      </td>
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
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            total={rows.length}
            noun="problems"
            onPageChange={setPage}
          />
        </>
      )}
    </PageShell>
  );
}
