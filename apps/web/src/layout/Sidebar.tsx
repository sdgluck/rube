import { Link, NavLink } from "react-router-dom";
import Spinner from "#components/Spinner";
import { trpc } from "#/trpc";
import { VERSION, IS_BETA, GIT_SHA } from "#/version";
import { NAV_SECTIONS, visibleSections, type NavMetric } from "#/nav";
import { modChord } from "#components/Kbd";
import styles from "./Sidebar.module.css";

function checkedAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The sidebar footer: one aggregate dot, a plain-language summary, and a
 * tooltip breaking it down per integration. The tooltip opens *above* the
 * footer — there is no room beside a rail pinned to the viewport edge.
 */
export function SidebarHealthDot() {
  const query = trpc.health.status.useQuery(undefined, {
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const services = query.data;
  if (!services) return null;

  const configured = services.filter((s) => s.configured);
  if (configured.length === 0) return null;

  const withStatus = configured.filter((s) => s.status !== null);
  if (withStatus.length === 0) return null;

  const errorCount = withStatus.filter((s) => s.status === "error").length;
  const healthy = withStatus.length - errorCount;

  let colorClass = "health-dot-green";
  if (errorCount === withStatus.length) {
    colorClass = "health-dot-red";
  } else if (errorCount > 0) {
    colorClass = "health-dot-orange";
  }

  const summary = `${healthy} of ${withStatus.length} healthy`;

  return (
    // The tooltip is CSS :hover *and* :focus-visible so it's reachable by
    // keyboard; the summary in aria-label carries the same information for
    // screen readers and touch, where a hover tooltip never appears.
    <Link to="/settings/health" className="health-dot-link" aria-label={`${summary} — view health`}>
      <span className={`health-dot ${colorClass}`} />
      <span className="health-summary">{summary}</span>
      <div className="health-tooltip" aria-hidden="true">
        <div className="health-tooltip-list">
          {withStatus.map((s) => (
            <div key={s.service} className="health-tooltip-row">
              <span className={`health-tooltip-dot ${s.status === "ok" ? "health-dot-green" : "health-dot-red"}`} />
              <span className="health-tooltip-name">{s.service}</span>
              <span className={`health-tooltip-latency ${s.status === "ok" ? "" : "health-tooltip-latency-error"}`}>
                {s.status === "ok" ? (s.timestamp ? checkedAgo(s.timestamp) : "—") : "failing"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function SidebarStreamCount() {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, {
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });
  const count = sessionsQuery.data?.length || 0;
  if (count === 0) return null;
  return <span className="stream-badge">{count}</span>;
}

type NavMetrics = {
  collections: number;
  media: number;
  rules: number;
  users: number;
  prerolls: number;
  eventsErrors24h: number;
  cleanupDueSoon: number;
  overlaysStatus: "ok" | "error" | null;
  jobsStatus: "ok" | "error" | null;
  arrQueue: number;
  arrsStatus: "ok" | "error" | null;
};

function NavMetricSlot({ metric, metrics }: { metric: NavMetric; metrics: NavMetrics | undefined }) {
  if (metric.kind === "streams") return <SidebarStreamCount />;
  if (!metrics) return <span className="nav-metric nav-metric-placeholder" aria-hidden="true" />;
  if (metric.kind === "count") {
    const value = metrics[metric.key];
    if (!value) return <span className="nav-metric nav-metric-placeholder" aria-hidden="true" />;
    // Neither an error tally nor an imminent deletion is a neutral count, and
    // neither must read as one.
    const isErrors = metric.key === "eventsErrors24h" || metric.key === "cleanupDueSoon";
    return (
      <span className={`nav-metric ${isErrors ? "nav-metric-error" : "nav-metric-count"}`} title={`${value}`}>
        {value > 999 ? `${Math.floor(value / 1000)}k` : value}
      </span>
    );
  }
  // status
  const value = metrics[metric.key];
  if (!value) return <span className="nav-metric nav-metric-placeholder" aria-hidden="true" />;
  return (
    <span
      className={`nav-metric nav-metric-status nav-metric-status-${value}`}
      title={`Last run: ${value}`}
      aria-label={`Last run: ${value}`}
    />
  );
}

/**
 * What's running right now, from anywhere in the app.
 *
 * Rule runs are listed beside job runs because they are the same kind of thing
 * to the person waiting on one — and because a rule run's only route back used
 * to be the table row that started it, which is exactly what disappeared on a
 * reload.
 */
function SidebarActiveJobs() {
  const activeRunsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const activeRuleRunsQuery = trpc.rules.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => activeRunsQuery.refetch(),
  });
  const cancelRuleRunMutation = trpc.rules.cancelRun.useMutation({
    onSuccess: () => activeRuleRunsQuery.refetch(),
  });

  const runs = activeRunsQuery.data;
  // Rule runs a job owns are already represented by that job's own row; listing
  // both would report one piece of work twice. Everything else — a cron rule, a
  // rule woken by a trigger, one standing behind another — has no other row to
  // appear as, and `rule-schedules` now returns the moment it has queued them.
  const ruleRuns = (activeRuleRunsQuery.data ?? []).filter((run) => run.trigger !== "job");
  if ((!runs || runs.length === 0) && ruleRuns.length === 0) return null;

  return (
    <div className={styles.sidebarJobs}>
      <div className={styles.sidebarJobsTitle}>Running</div>
      {ruleRuns.map((run) => (
        <div key={run.id} className={styles.sidebarJob}>
          <Spinner size="sm" variant="inverse" />
          <Link to={`/rules/${run.ruleId}/runs?run=${run.id}`} className={styles.sidebarJobLink}>
            <span className={styles.sidebarJobName}>
              {run.ruleName}
              {run.phase === "test" ? " (test)" : ""}
            </span>
            {run.progress > 0 && <span className={styles.sidebarJobProgress}>{Math.round(run.progress * 100)}%</span>}
          </Link>
          <button
            className={styles.sidebarCancel}
            onClick={(e) => {
              e.stopPropagation();
              cancelRuleRunMutation.mutate({ runId: run.id });
            }}
            title={`Cancel ${run.ruleName}`}
            aria-label={`Cancel ${run.ruleName}`}
          >
            &times;
          </button>
        </div>
      ))}
      {(runs ?? []).map((run) => (
        <div key={run.id} className={styles.sidebarJob}>
          <Spinner size="sm" variant="inverse" />
          {/* A real link, not a div with onClick: focusable, middle-clickable,
              and announced as a link. */}
          <Link to={`/jobs/runs/${run.id}`} className={styles.sidebarJobLink}>
            <span className={styles.sidebarJobName}>{run.jobName}</span>
            {run.progress > 0 && <span className={styles.sidebarJobProgress}>{Math.round(run.progress * 100)}%</span>}
          </Link>
          <button
            className={styles.sidebarCancel}
            onClick={(e) => {
              e.stopPropagation();
              cancelMutation.mutate({ runId: run.id });
            }}
            title={`Cancel ${run.jobName}`}
            aria-label={`Cancel ${run.jobName}`}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

type SidebarProps = {
  onOpenPalette: () => void;
};

export default function Sidebar({ onOpenPalette }: SidebarProps) {
  const metricsQuery = trpc.nav.metrics.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const metrics = metricsQuery.data;
  // Shared with the setup banner and the Stats setup card, so this is a cache
  // read rather than a third request.
  const setupQuery = trpc.onboarding.status.useQuery(undefined, { retry: false });
  const sections = visibleSections(NAV_SECTIONS, setupQuery.data?.complete);

  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">
        <img src="/favicon.svg" alt="" className="sidebar-mark" width={22} height={22} />
        Tinkerbell
        {IS_BETA && (
          <Link to="/settings/changelog" className="version-pill" title={`v${VERSION} — view changelog`}>
            beta
          </Link>
        )}
      </h1>
      <button
        type="button"
        className="sidebar-search"
        onClick={() => onOpenPalette()}
        title={`Search (${modChord("K")})`}
      >
        <span className="sidebar-search-icon" aria-hidden="true">
          ⌕
        </span>
        <span className="sidebar-search-label">Search…</span>
        <span className="sidebar-search-kbd" aria-hidden="true">
          {modChord("K")}
        </span>
      </button>
      <hr className="sidebar-search-divider" />
      <nav aria-label="Main">
        {sections.map((section) => (
          <div key={section.label} className="nav-section">
            <div className="nav-section-title">{section.label}</div>
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-link">
                <span className="nav-link-label">{item.label}</span>
                {item.metric && <NavMetricSlot metric={item.metric} metrics={metrics} />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <SidebarActiveJobs />
      <div className="sidebar-footer">
        <SidebarHealthDot />
        <Link
          to="/settings/changelog"
          className="sidebar-version"
          title={GIT_SHA ? `${GIT_SHA} — view changelog` : "View changelog"}
        >
          v{VERSION}
        </Link>
      </div>
    </aside>
  );
}
