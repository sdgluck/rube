import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import EmptyState from "#components/EmptyState";
import PageShell from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import { DetailSkeleton } from "#components/Skeleton";
import { PageCrumbs } from "#layout/AppBar";
import { useLocalSort } from "#hooks/useLocalSort";
import useSwipeBack from "#hooks/useSwipeBack";
import { formatDuration, formatElapsed } from "#/format";
import { fetchRuleRunLog, isRunActive, useRunLog } from "#pages/Jobs/shared/useRunLog";
import jobStyles from "#pages/Jobs/Jobs.module.css";
import styles from "./Rules.module.css";
import type { RulesOutcome } from "./index";

const PHASE_FILTERS = ["all", "run", "test"] as const;
type PhaseFilter = (typeof PHASE_FILTERS)[number];

const ERROR_PATTERN = /error|failed|exception|fatal|panic|ENOENT|ECONNREFUSED/i;

function RunStatusBadge({ status }: { status: string }) {
  const cls =
    status === "running" || status === "cancelling" || status === "queued"
      ? jobStyles.badgeRunning
      : status === "ok"
        ? jobStyles.badgeCompleted
        : status === "error"
          ? jobStyles.badgeFailed
          : jobStyles.badgeCancelled;
  // `cancelling` and `queued` are real states the user can act on, so they are
  // named rather than rounded to the nearest finished-looking word.
  const label = status === "cancelling" ? "cancelling…" : status === "queued" ? "queued" : status;
  return <span className={`${jobStyles.badge} ${cls}`}>{label}</span>;
}

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  if (remaining < 1000) return null;
  return `~${formatDuration(remaining)} remaining`;
}

/**
 * Every run of one rule, and the detail of whichever is selected.
 *
 * A run used to exist only as a spinner in the rules table for as long as one
 * browser tab held one HTTP request open. Now each is a row with a log, so
 * "what did the nightly job actually do to this rule three days ago?" and "what
 * is it doing right now?" are the same question asked of the same list.
 *
 * The selected run lives in `?run=`, which is what makes a live run linkable —
 * from the sidebar, from a toast, or to someone else.
 */
export default function RuleRuns({ outcome = "collection" }: { outcome?: RulesOutcome } = {}) {
  const { ruleId } = useParams<{ ruleId: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const [params, setParams] = useSearchParams();
  const rulesPath = outcome === "cleanup" ? "/cleanup/rules" : "/rules";

  const phase = (PHASE_FILTERS as readonly string[]).includes(params.get("phase") ?? "")
    ? (params.get("phase") as PhaseFilter)
    : "all";

  const ruleQuery = trpc.rules.get.useQuery({ id: ruleId! }, { enabled: !!ruleId });
  const runsQuery = trpc.rules.runs.useQuery(
    { ruleId: ruleId!, phase: phase === "all" ? undefined : phase, limit: 100 },
    { enabled: !!ruleId, refetchInterval: 3000 },
  );

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const selectedId = params.get("run") ?? runs[0]?.id ?? null;

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: runs,
    accessors: {
      status: (r) => r.status,
      startedAt: (r) => r.startedAt,
      // A run still going has no finish time; sort those by elapsed so far
      // rather than dropping them to the bottom as "missing".
      duration: (r) => (r.finishedAt ?? Date.now()) - r.startedAt,
      collections: (r) => r.collectionCount ?? -1,
    },
    defaultKey: "startedAt",
    defaultDir: "desc",
    descFirst: ["startedAt", "duration", "collections"],
  });

  const selectRun = (runId: string) => {
    const next = new URLSearchParams(params);
    next.set("run", runId);
    setParams(next, { replace: true });
  };

  const setPhase = (value: PhaseFilter) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("phase");
    else next.set("phase", value);
    next.delete("run");
    setParams(next, { replace: true });
  };

  if (!ruleId) return null;

  return (
    <PageShell count={runs.length > 0 ? `${runs.length} runs` : undefined}>
      <div ref={swipeRef}>
        <PageCrumbs
          crumbs={[
            { label: outcome === "cleanup" ? "Cleanup rules" : "Rules", to: rulesPath },
            { label: ruleQuery.data?.name ?? "Rule" },
            { label: "Runs" },
          ]}
        />

        <CardSection
          titleClassName={jobStyles.detailSectionTitle}
          title={
            <span className={styles.runsSectionHead}>
              Run history
              <span className={styles.runsFilter} role="group" aria-label="Filter runs by phase">
                {PHASE_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={value === phase ? styles.runsFilterActive : styles.runsFilterBtn}
                    onClick={() => setPhase(value)}
                  >
                    {value === "all" ? "All" : value === "run" ? "Runs" : "Tests"}
                  </button>
                ))}
              </span>
            </span>
          }
        >
          {runsQuery.isLoading ? (
            <p>Loading runs…</p>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon="list"
              title="No runs yet"
              description="Runs appear here once this rule has been run or tested — by you or by the nightly job."
            />
          ) : (
            <div className="table-scroll in-panel" data-scroll="x">
              <table className={jobStyles.compactTable}>
                <thead>
                  <tr>
                    <SortableTh sortKey="status" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Status
                    </SortableTh>
                    <SortableTh sortKey="startedAt" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Started
                    </SortableTh>
                    <SortableTh sortKey="duration" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Duration
                    </SortableTh>
                    <th>Trigger</th>
                    <SortableTh sortKey="collections" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Collections
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((run) => (
                    <tr
                      key={run.id}
                      className={`${jobStyles.clickableRow} ${run.id === selectedId ? styles.runRowSelected : ""}`}
                      onClick={() => selectRun(run.id)}
                    >
                      <td>
                        <RunStatusBadge status={run.status} />
                        {run.phase === "test" && <span className={styles.runPhaseTag}>test</span>}
                      </td>
                      <td className={jobStyles.runMeta}>
                        <RelativeTime timestamp={run.startedAt} />
                      </td>
                      <td className={jobStyles.runMeta}>{formatElapsed(run.startedAt, run.finishedAt)}</td>
                      <td className={jobStyles.runMeta}>
                        {run.trigger === "job" && run.jobRunId ? (
                          // The parent job run is where the rest of that night's
                          // work is, so the breakdown links both ways.
                          <Link to={`/jobs/runs/${run.jobRunId}`} onClick={(e) => e.stopPropagation()}>
                            Generate job
                          </Link>
                        ) : run.trigger === "job" ? (
                          "Generate job"
                        ) : (
                          "Manual"
                        )}
                      </td>
                      <td className={jobStyles.runMeta}>{run.collectionCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>

        {selectedId && <RunDetail runId={selectedId} />}
      </div>
    </PageShell>
  );
}

/** The selected run: what it's doing, how far in, and everything it has said. */
function RunDetail({ runId }: { runId: string }) {
  const utils = trpc.useUtils();
  const runQuery = trpc.rules.runDetail.useQuery(
    { runId },
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? undefined) ? 1000 : false) },
  );
  const cancelMutation = trpc.rules.cancelRun.useMutation({
    onSuccess: () => {
      runQuery.refetch();
      utils.rules.activeRuns.invalidate();
    },
  });

  const run = runQuery.data;
  const log = useRunLog(runId, isRunActive(run?.status ?? undefined), fetchRuleRunLog);

  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const filteredLog = useMemo(() => {
    if (!log) return "";
    if (!filter && !errorsOnly) return log;
    return log
      .split("\n")
      .filter((line) => {
        if (errorsOnly && !ERROR_PATTERN.test(line)) return false;
        if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      })
      .join("\n");
  }, [log, filter, errorsOnly]);

  const isFiltering = !!(filter || errorsOnly);

  useEffect(() => {
    if (autoScroll.current && logRef.current && !isFiltering) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, isFiltering]);

  const handleLogScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleDownload = () => {
    if (!log) return;
    const blob = new Blob([log], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `rule-run-${runId}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (runQuery.isLoading) return <DetailSkeleton />;
  if (!run) return null;

  const eta = run.status === "running" ? formatEta(run.startedAt, run.progress) : null;
  const cancellable = run.status === "queued" || run.status === "running";

  return (
    <CardSection title="Run detail" titleClassName={jobStyles.detailSectionTitle}>
      <div className={jobStyles.runHeader}>
        <RunStatusBadge status={run.status} />
        {cancellable && (
          <button
            className={`${jobStyles.button} ${jobStyles.buttonDanger}`}
            onClick={() => cancelMutation.mutate({ runId: run.id })}
            disabled={cancelMutation.isPending}
          >
            Cancel
          </button>
        )}
        {run.trigger === "job" && run.jobRunId && (
          <Link className={jobStyles.runLink} to={`/jobs/runs/${run.jobRunId}`}>
            View the job run
          </Link>
        )}
      </div>

      <div className={jobStyles.metaGrid}>
        <span className={jobStyles.metaLabel}>Started</span>
        <span>
          <RelativeTime timestamp={run.startedAt} />
        </span>
        {run.finishedAt && (
          <>
            <span className={jobStyles.metaLabel}>Finished</span>
            <span>
              <RelativeTime timestamp={run.finishedAt} />
            </span>
          </>
        )}
        <span className={jobStyles.metaLabel}>Duration</span>
        <span>{formatElapsed(run.startedAt, run.finishedAt)}</span>
        {eta && (
          <>
            <span className={jobStyles.metaLabel}>ETA</span>
            <span>{eta}</span>
          </>
        )}
        {run.collectionCount != null && (
          <>
            <span className={jobStyles.metaLabel}>Produced</span>
            <span>
              {run.collectionCount} collection{run.collectionCount === 1 ? "" : "s"}
              {run.itemCount != null ? `, ${run.itemCount} item${run.itemCount === 1 ? "" : "s"}` : ""}
            </span>
          </>
        )}
        {run.message && (
          <>
            <span className={jobStyles.metaLabel}>Status</span>
            <span>{run.message}</span>
          </>
        )}
        {run.error && (
          <>
            <span className={jobStyles.metaLabel}>Error</span>
            <span>{run.error}</span>
          </>
        )}
      </div>

      {isRunActive(run.status) && run.progress > 0 && (
        <div className={jobStyles.progressBar}>
          <div className={jobStyles.progressFill} style={{ width: `${Math.round(run.progress * 100)}%` }} />
        </div>
      )}

      <div className={jobStyles.logToolbar}>
        <input
          type="text"
          className={jobStyles.logFilterInput}
          placeholder="Filter log…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className={jobStyles.logErrorToggle}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Errors only
        </label>
        {log && (
          <>
            <button className={jobStyles.logToolbarBtn} onClick={() => navigator.clipboard.writeText(log)}>
              Copy
            </button>
            <button className={jobStyles.logToolbarBtn} onClick={handleDownload}>
              Download
            </button>
          </>
        )}
      </div>

      <div className={jobStyles.logWrapper}>
        <pre ref={logRef} className={jobStyles.logViewer} onScroll={handleLogScroll}>
          {filteredLog || (isFiltering ? "(no matching lines)" : "(no output yet)")}
        </pre>
      </div>
    </CardSection>
  );
}
