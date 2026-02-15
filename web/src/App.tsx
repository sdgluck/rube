import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import Settings from "./pages/Settings";
import Collections from "./pages/Collections";
import CollectionDetail from "./pages/CollectionDetail";
import Jobs from "./pages/Jobs";
import JobRun from "./pages/JobRun";
import { trpc } from "./trpc";
import styles from "./pages/Jobs.module.css";

function SidebarActiveJobs() {
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
        <div key={run.id} className={styles.sidebarJob}>
          <div className={styles.spinner} />
          <span className={styles.sidebarJobName}>{run.job_name}</span>
          {run.progress > 0 && <span className={styles.sidebarJobProgress}>{Math.round(run.progress * 100)}%</span>}
          <button
            className={styles.sidebarCancel}
            onClick={() => cancelMutation.mutate({ runId: run.id })}
            title="Cancel"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="sidebar-title">Tinkerbell</h1>
        <nav>
          <NavLink to="/collections" className="nav-link">
            Collections
          </NavLink>
          <NavLink to="/jobs" className="nav-link">
            Jobs
          </NavLink>
          <NavLink to="/settings" className="nav-link">
            Settings
          </NavLink>
        </nav>
        <SidebarActiveJobs />
      </aside>
      <main className="content">
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:ratingKey" element={<CollectionDetail />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/runs/:runId" element={<JobRun />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/collections" replace />} />
        </Routes>
      </main>
    </div>
  );
}
