import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import EmptyState from "#components/EmptyState";
import PageShell, { StatusChip } from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import RunLog from "#components/RunLog";
import SortableTh from "#components/SortableTh";
import { SkeletonTable } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import { PageCrumbs } from "#layout/AppBar";
import { useLocalSort } from "#hooks/useLocalSort";
import useSwipeBack from "#hooks/useSwipeBack";
import { formatDuration, formatElapsed } from "#/format";
import { fetchRuleRunLog, isRunActive, useRunLog } from "#pages/Jobs/shared/useRunLog";
import shared from "#/styles/shared.module.css";
import styles from "./Rules.module.css";
import type { RulesOutcome } from "./index";

const PHASE_FILTERS = ["all", "run", "test"] as const;
type PhaseFilter = (typeof PHASE_FILTERS)[number];

const PHASE_LABELS: Record<PhaseFilter, string> = { all: "All", run: "Runs", test: "Tests" };

/** Terminal statuses read as outcomes; the live ones read as themselves. */
function statusClass(status: string): string {
  if (status === "ok") return shared.runBadgeOk;
  if (status === "error") return shared.runBadgeError;
  if (status === "cancelled") return shared.runBadgeCancelled;
  return shared.runBadgeBusy;
}

function RunBadge({ status }: { status: string }) {
  // `cancelling` and `queued` are states the user can still act on, so they are
  // named rather than rounded to the nearest finished-looking word.
  const label = status === "cancelling" ? "cancelling…" : status;
  return <span className={`${shared.runBadge} ${statusClass(status)}`}>{label}</span>;
}

function formatEta(startMs: number, progress: number): string | null {
  if (progress <= 0 || progress >= 1) return null;
  const elapsed = Date.now() - startMs;
  const remaining = elapsed / progress - elapsed;
  if (remaining < 1000) return null;
  return `~${formatDuration(remaining)} remaining`;
}

/**
 * Every run of one rule, with the selected one open beside it.
 *
 * A run used to exist only as a spinner in the rules table, for as long as one
 * browser tab held one request open. Two panes because the two questions are
 * asked together: "how has this rule been doing?" is the list, "what did this
 * run actually do?" is the detail, and answering the second shouldn't cost you
 * sight of the first.
 *
 * The selection lives in `?run=`, which is what makes a live run linkable —
 * from the sidebar, from a job's rule breakdown, or to someone else.
 */
export default function RuleRuns({ outcome = "collection" }: { outcome?: RulesOutcome } = {}) {
  const { ruleId } = useParams<{ ruleId: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const [params, setParams] = useSearchParams();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const rulesPath = outcome === "cleanup" ? "/cleanup/rules" : "/rules";

  const phase = (PHASE_FILTERS as readonly string[]).includes(params.get("phase") ?? "")
    ? (params.get("phase") as PhaseFilter)
    : "all";

  const ruleQuery = trpc.rules.get.useQuery({ id: ruleId! }, { enabled: !!ruleId });
  const runsQuery = trpc.rules.runs.useQuery(
    { ruleId: ruleId!, phase: phase === "all" ? undefined : phase, limit: 100 },
    { enabled: !!ruleId, refetchInterval: 3000 },
  );
  const activeRunsQuery = trpc.rules.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const active = (activeRunsQuery.data ?? []).find((run) => run.ruleId === ruleId) ?? null;

  const runMutation = trpc.rules.run.useMutation();
  const testMutation = trpc.rules.test.useMutation();
  const cancelMutation = trpc.rules.cancelRun.useMutation();

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  // Default to the newest run, so arriving from the table lands on something.
  const selectedId = params.get("run") ?? runs[0]?.id ?? null;

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: runs,
    accessors: {
      status: (r) => r.status,
      startedAt: (r) => r.startedAt,
      // A run still going has no finish time; sort those by elapsed so far
      // rather than dropping them to the bottom as "missing".
      duration: (r) => (r.finishedAt ?? Date.now()) - r.startedAt,
    },
    defaultKey: "startedAt",
    defaultDir: "desc",
    descFirst: ["startedAt", "duration"],
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    if (key === "phase") next.delete("run");
    setParams(next, { replace: true });
  };

  /** Start a run/test and follow it — both attach to one already in flight. */
  const start = (kind: "run" | "test") => {
    const mutation = kind === "run" ? runMutation : testMutation;
    mutation.mutate(
      { id: ruleId! },
      {
        onSuccess: (res) => {
          setParam("run", res.runId);
          utils.rules.activeRuns.invalidate();
          utils.rules.runs.invalidate({ ruleId: ruleId! });
          if (res.attached) addToast("Already running — showing the run in progress.", "info");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  };

  if (!ruleId) return null;

  const pct = active ? Math.round(active.progress * 100) : 0;

  return (
    <PageShell
      count={runs.length > 0 ? runs.length.toLocaleString() : undefined}
      chip={
        active ? (
          <StatusChip tone="running" dot>
            {active.phase === "test" ? "Testing" : "Running"}
            {pct > 0 ? ` ${pct}%` : ""}
          </StatusChip>
        ) : undefined
      }
      actions={
        <>
          {active && (
            <button
              type="button"
              className={styles.runsActionDanger}
              onClick={() =>
                cancelMutation.mutate({ runId: active.id }, { onSuccess: () => utils.rules.activeRuns.invalidate() })
              }
              disabled={cancelMutation.isPending}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className={styles.runsActionGhost}
            onClick={() => start("test")}
            disabled={testMutation.isPending}
          >
            Test
          </button>
          <button
            type="button"
            className={styles.runsAction}
            onClick={() => start("run")}
            disabled={runMutation.isPending}
          >
            Run now
          </button>
        </>
      }
    >
      <PageCrumbs
        crumbs={[
          { label: outcome === "cleanup" ? "Cleanup rules" : "Rules", to: rulesPath },
          { label: ruleQuery.data?.name ?? "Rule" },
          { label: "Runs" },
        ]}
      />

      <div ref={swipeRef} className={styles.runsLayout}>
        <CardSection
          className={shared.runCardCapped}
          titleClassName={shared.runCardTitle}
          title={
            <span className={styles.runsSectionHead}>
              History
              <span className={styles.segmented} role="tablist" aria-label="Filter runs by phase">
                {PHASE_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={value === phase}
                    className={`${styles.segmentedBtn} ${value === phase ? styles.segmentedBtnActive : ""}`}
                    onClick={() => setParam("phase", value === "all" ? null : value)}
                  >
                    {PHASE_LABELS[value]}
                  </button>
                ))}
              </span>
            </span>
          }
        >
          {runsQuery.isLoading ? (
            <SkeletonTable rows={5} columns={3} />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon="list"
              title="No runs yet"
              description={
                phase === "test"
                  ? "This rule hasn't been tested yet."
                  : "Runs appear here once this rule has run — by you or by the nightly job."
              }
            />
          ) : (
            <div className="table-scroll in-panel" data-scroll="x">
              <table className={shared.compactTable}>
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
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((run) => (
                    <tr
                      key={run.id}
                      className={`${shared.clickableRow} ${run.id === selectedId ? styles.runRowSelected : ""}`}
                      aria-current={run.id === selectedId ? "true" : undefined}
                      onClick={() => setParam("run", run.id)}
                    >
                      <td>
                        <RunBadge status={run.status} />
                        {/* A test sits in the same list and reads identically at
                            a glance, so it says which it is. */}
                        {run.phase === "test" && <span className={styles.runPhaseTag}>test</span>}
                      </td>
                      <td className={shared.cellMuted}>
                        <RelativeTime timestamp={run.startedAt} />
                      </td>
                      <td className={shared.cellMuted}>{formatElapsed(run.startedAt, run.finishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>

        <div className={styles.runsDetailStack}>
          {selectedId ? (
            <RunDetail runId={selectedId} />
          ) : (
            <CardSection className={shared.runCard} titleClassName={shared.runCardTitle} title="Run detail">
              <EmptyState icon="list" title="Nothing selected" description="Pick a run to see what it did." />
            </CardSection>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** The selected run: what it did, how far in, and everything it said. */
function RunDetail({ runId }: { runId: string }) {
  const runQuery = trpc.rules.runDetail.useQuery(
    { runId },
    // A finished row never changes again, so stop polling when it settles.
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? undefined) ? 1000 : false) },
  );
  const run = runQuery.data;
  const log = useRunLog(runId, isRunActive(run?.status ?? undefined), fetchRuleRunLog);

  if (!run) return null;

  const live = isRunActive(run.status);
  const eta = run.status === "running" ? formatEta(run.startedAt, run.progress) : null;

  return (
    <>
      <CardSection
        className={shared.runCard}
        titleClassName={shared.runCardTitle}
        title={
          <span className={styles.runsSectionHeadTight}>
            {run.phase === "test" ? "Test detail" : "Run detail"}
            <RunBadge status={run.status} />
          </span>
        }
      >
        {live && run.progress > 0 && (
          <div className={shared.progressBar}>
            <div className={shared.progressFill} style={{ width: `${Math.round(run.progress * 100)}%` }} />
          </div>
        )}

        <div className={shared.metaGrid}>
          <span className={shared.metaLabel}>Started</span>
          <span>
            <RelativeTime timestamp={run.startedAt} />
          </span>
          {run.finishedAt && (
            <>
              <span className={shared.metaLabel}>Finished</span>
              <span>
                <RelativeTime timestamp={run.finishedAt} />
              </span>
            </>
          )}
          <span className={shared.metaLabel}>Duration</span>
          <span>{formatElapsed(run.startedAt, run.finishedAt)}</span>
          {eta && (
            <>
              <span className={shared.metaLabel}>ETA</span>
              <span>{eta}</span>
            </>
          )}
          <span className={shared.metaLabel}>Trigger</span>
          <span>
            {run.trigger === "job" ? (
              run.jobRunId ? (
                // The rest of that night's work is on the job run, so the
                // breakdown links both ways.
                <Link to={`/jobs/runs/${run.jobRunId}`}>Generate job</Link>
              ) : (
                "Generate job"
              )
            ) : (
              "Manual"
            )}
          </span>
          {run.collectionCount != null && (
            <>
              <span className={shared.metaLabel}>Produced</span>
              <span>
                {run.collectionCount} collection{run.collectionCount === 1 ? "" : "s"}
                {run.itemCount != null ? `, ${run.itemCount.toLocaleString()} items` : ""}
              </span>
            </>
          )}
          {run.message && (
            <>
              <span className={shared.metaLabel}>Status</span>
              <span>{run.message}</span>
            </>
          )}
          {run.error && (
            <>
              <span className={shared.metaLabel}>Error</span>
              <span className={styles.runErrorText}>{run.error}</span>
            </>
          )}
        </div>
      </CardSection>

      <CardSection className={shared.runCard} titleClassName={shared.runCardTitle} title="Log">
        <RunLog log={log} downloadName={`rule-run-${runId}.txt`} ariaLabel="Rule run log" />
      </CardSection>
    </>
  );
}
