import { Link, NavLink, useNavigate } from "react-router-dom";
import Spinner from "#components/Spinner";
import { trpc } from "#/trpc";
import { VERSION, IS_BETA } from "#/version";
import { NAV_SECTIONS } from "#/nav";
import styles from "#pages/Jobs/Jobs.module.css";

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

  let colorClass = "health-dot-green";
  if (errorCount === withStatus.length) {
    colorClass = "health-dot-red";
  } else if (errorCount > 0) {
    colorClass = "health-dot-orange";
  }

  return (
    <Link to="/settings/health" className="health-dot-link">
      <span className={`health-dot ${colorClass}`} />
      <div className="health-tooltip">
        <div className="health-tooltip-list">
          {withStatus.map((s) => (
            <div key={s.service} className="health-tooltip-row">
              <span className={`health-tooltip-dot ${s.status === "ok" ? "health-dot-green" : "health-dot-red"}`} />
              <span className="health-tooltip-name">{s.service}</span>
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

function SidebarActiveJobs() {
  const navigate = useNavigate();
  const activeRunsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => activeRunsQuery.refetch(),
  });

  const runs = activeRunsQuery.data;
  if (!runs || runs.length === 0) return null;

  return (
    <div className={styles.sidebarJobs}>
      <div className={styles.sidebarJobsTitle}>Running</div>
      {runs.map((run) => (
        <div key={run.id} className={styles.sidebarJob} onClick={() => navigate(`/jobs/runs/${run.id}`)}>
          <Spinner size="sm" variant="inverse" />
          <span className={styles.sidebarJobName}>{run.jobName}</span>
          {run.progress > 0 && <span className={styles.sidebarJobProgress}>{Math.round(run.progress * 100)}%</span>}
          <button
            className={styles.sidebarCancel}
            onClick={(e) => {
              e.stopPropagation();
              cancelMutation.mutate({ runId: run.id });
            }}
            title="Cancel"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
};

export default function Sidebar({ open, onClose, onOpenPalette }: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <h1 className="sidebar-title">
        Tinkerbell
        {IS_BETA && (
          <Link to="/changelog" className="version-pill" title={`v${VERSION} — view changelog`} onClick={onClose}>
            beta
          </Link>
        )}
        <SidebarHealthDot />
      </h1>
      <Link to="/changelog" className="sidebar-version" onClick={onClose}>
        v{VERSION}
      </Link>
      <button
        type="button"
        className="sidebar-search"
        onClick={() => {
          onClose();
          onOpenPalette();
        }}
        title="Search (⌘K)"
      >
        <span className="sidebar-search-icon" aria-hidden="true">
          ⌕
        </span>
        <span className="sidebar-search-label">Search…</span>
        <span className="sidebar-search-kbd">⌘K</span>
      </button>
      <hr className="sidebar-search-divider" />
      <nav>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="nav-section">
            <div className="nav-section-title">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={item.badge ? "nav-link nav-link-with-badge" : "nav-link"}
                onClick={onClose}
              >
                {item.label}
                {item.badge === "streams" && <SidebarStreamCount />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <SidebarActiveJobs />
    </aside>
  );
}
