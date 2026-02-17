import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import Stats from "./pages/Stats";
import Settings from "./pages/Settings";
import SettingsPlex from "./pages/SettingsPlex";
import SettingsAi from "./pages/SettingsAi";
import SettingsRadarr from "./pages/SettingsRadarr";
import SettingsSonarr from "./pages/SettingsSonarr";
import Collections from "./pages/Collections";
import CollectionDetail from "./pages/CollectionDetail";
import Rules from "./pages/Rules";
import Media from "./pages/Media";
import MediaDetail from "./pages/MediaDetail";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import JobRun from "./pages/JobRun";
import Users from "./pages/Users";
import { trpc } from "./trpc";
import styles from "./pages/Jobs.module.css";

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
          <div className={styles.spinner} />
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

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="sidebar-title">Tinkerbell</h1>
        <nav>
          <NavLink to="/stats" className="nav-link">
            Stats
          </NavLink>
          <NavLink to="/collections" className="nav-link">
            Collections
          </NavLink>
          <NavLink to="/media" className="nav-link">
            Media
          </NavLink>
          <NavLink to="/rules" className="nav-link">
            Rules
          </NavLink>
          <NavLink to="/users" className="nav-link">
            Users
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
          <Route path="/stats" element={<Stats />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:ratingKey" element={<CollectionDetail />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/media" element={<Media />} />
          <Route path="/media/:ratingKey" element={<MediaDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />
          <Route path="/jobs/runs/:runId" element={<JobRun />} />
          <Route path="/settings" element={<Settings />}>
            <Route index element={<Navigate to="/settings/plex" replace />} />
            <Route path="plex" element={<SettingsPlex />} />
            <Route path="ai" element={<SettingsAi />} />
            <Route path="radarr" element={<SettingsRadarr />} />
            <Route path="sonarr" element={<SettingsSonarr />} />
          </Route>
          <Route path="*" element={<Navigate to="/stats" replace />} />
        </Routes>
      </main>
    </div>
  );
}
