import { lazy, Suspense, useState, useCallback } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, Link } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import Settings from "./pages/Settings";
import { trpc } from "./trpc";
import styles from "./pages/Jobs.module.css";

const Stats = lazy(() => import("./pages/Stats"));
const SettingsPlex = lazy(() => import("./pages/SettingsPlex"));
const SettingsAi = lazy(() => import("./pages/SettingsAi"));
const SettingsArrs = lazy(() => import("./pages/SettingsArrs"));
const SettingsDatabases = lazy(() => import("./pages/SettingsDatabases"));
const SettingsNotifications = lazy(() => import("./pages/SettingsNotifications"));
const SettingsNotificationsDiscord = lazy(() => import("./pages/SettingsNotificationsDiscord"));
const SettingsNotificationsGotify = lazy(() => import("./pages/SettingsNotificationsGotify"));
const SettingsNotificationsLunaSea = lazy(() => import("./pages/SettingsNotificationsLunaSea"));
const SettingsNotificationsPushbullet = lazy(() => import("./pages/SettingsNotificationsPushbullet"));
const SettingsNotificationsPushover = lazy(() => import("./pages/SettingsNotificationsPushover"));
const SettingsNotificationsSlack = lazy(() => import("./pages/SettingsNotificationsSlack"));
const SettingsNotificationsTelegram = lazy(() => import("./pages/SettingsNotificationsTelegram"));
const SettingsNotificationsWebhook = lazy(() => import("./pages/SettingsNotificationsWebhook"));
const SettingsHealth = lazy(() => import("./pages/SettingsHealth"));
const Collections = lazy(() => import("./pages/Collections"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const Rules = lazy(() => import("./pages/Rules"));
const Media = lazy(() => import("./pages/Media"));
const MediaDetail = lazy(() => import("./pages/MediaDetail"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const JobRun = lazy(() => import("./pages/JobRun"));
const Users = lazy(() => import("./pages/Users"));
const Overlays = lazy(() => import("./pages/Overlays"));
const Events = lazy(() => import("./pages/Events"));
const StressTest = lazy(() => import("./pages/StressTest"));

function SidebarHealthDot() {
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

function SidebarStreamCount() {
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

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p>Loading...</p>}>{children}</Suspense>;
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="layout">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>
      <div className={`sidebar-overlay ${sidebarOpen ? "sidebar-overlay-visible" : ""}`} onClick={closeSidebar} />
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <h1 className="sidebar-title">
          Tinkerbell <SidebarHealthDot />
        </h1>
        <nav>
          <NavLink to="/stats" className="nav-link nav-link-with-badge" onClick={closeSidebar}>
            Stats
            <SidebarStreamCount />
          </NavLink>
          <NavLink to="/collections" className="nav-link" onClick={closeSidebar}>
            Collections
          </NavLink>
          <NavLink to="/media" className="nav-link" onClick={closeSidebar}>
            Media
          </NavLink>
          <NavLink to="/rules" className="nav-link" onClick={closeSidebar}>
            Rules
          </NavLink>
          <NavLink to="/overlays" className="nav-link" onClick={closeSidebar}>
            Overlays
          </NavLink>
          <NavLink to="/users" className="nav-link" onClick={closeSidebar}>
            Users
          </NavLink>
          <NavLink to="/jobs" className="nav-link" onClick={closeSidebar}>
            Jobs
          </NavLink>
          <NavLink to="/events" className="nav-link" onClick={closeSidebar}>
            Events
          </NavLink>
          <NavLink to="/settings" className="nav-link" onClick={closeSidebar}>
            Settings
          </NavLink>
        </nav>
        <SidebarActiveJobs />
      </aside>
      <main className="content">
        <ErrorBoundary>
          <Suspense fallback={<p>Loading...</p>}>
            <Routes>
              <Route
                path="/stats"
                element={
                  <LazyPage>
                    <Stats />
                  </LazyPage>
                }
              />
              <Route
                path="/collections"
                element={
                  <LazyPage>
                    <Collections />
                  </LazyPage>
                }
              />
              <Route
                path="/collections/:ratingKey"
                element={
                  <LazyPage>
                    <CollectionDetail />
                  </LazyPage>
                }
              />
              <Route
                path="/rules"
                element={
                  <LazyPage>
                    <Rules />
                  </LazyPage>
                }
              />
              <Route
                path="/media"
                element={
                  <LazyPage>
                    <Media />
                  </LazyPage>
                }
              />
              <Route
                path="/media/:ratingKey"
                element={
                  <LazyPage>
                    <MediaDetail />
                  </LazyPage>
                }
              />
              <Route
                path="/overlays"
                element={
                  <LazyPage>
                    <Overlays />
                  </LazyPage>
                }
              />
              <Route
                path="/users"
                element={
                  <LazyPage>
                    <Users />
                  </LazyPage>
                }
              />
              <Route
                path="/events"
                element={
                  <LazyPage>
                    <Events />
                  </LazyPage>
                }
              />
              <Route
                path="/jobs"
                element={
                  <LazyPage>
                    <Jobs />
                  </LazyPage>
                }
              />
              <Route
                path="/jobs/:jobId"
                element={
                  <LazyPage>
                    <JobDetail />
                  </LazyPage>
                }
              />
              <Route
                path="/jobs/runs/:runId"
                element={
                  <LazyPage>
                    <JobRun />
                  </LazyPage>
                }
              />
              <Route path="/settings" element={<Settings />}>
                <Route index element={<Navigate to="/settings/plex" replace />} />
                <Route
                  path="plex"
                  element={
                    <LazyPage>
                      <SettingsPlex />
                    </LazyPage>
                  }
                />
                <Route
                  path="ai"
                  element={
                    <LazyPage>
                      <SettingsAi />
                    </LazyPage>
                  }
                />
                <Route
                  path="arrs"
                  element={
                    <LazyPage>
                      <SettingsArrs />
                    </LazyPage>
                  }
                />
                <Route
                  path="databases"
                  element={
                    <LazyPage>
                      <SettingsDatabases />
                    </LazyPage>
                  }
                />
                <Route
                  path="notifications"
                  element={
                    <LazyPage>
                      <SettingsNotifications />
                    </LazyPage>
                  }
                >
                  <Route index element={<Navigate to="/settings/notifications/discord" replace />} />
                  <Route
                    path="discord"
                    element={
                      <LazyPage>
                        <SettingsNotificationsDiscord />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="gotify"
                    element={
                      <LazyPage>
                        <SettingsNotificationsGotify />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="lunasea"
                    element={
                      <LazyPage>
                        <SettingsNotificationsLunaSea />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="pushbullet"
                    element={
                      <LazyPage>
                        <SettingsNotificationsPushbullet />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="pushover"
                    element={
                      <LazyPage>
                        <SettingsNotificationsPushover />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="slack"
                    element={
                      <LazyPage>
                        <SettingsNotificationsSlack />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="telegram"
                    element={
                      <LazyPage>
                        <SettingsNotificationsTelegram />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="webhook"
                    element={
                      <LazyPage>
                        <SettingsNotificationsWebhook />
                      </LazyPage>
                    }
                  />
                </Route>
                <Route
                  path="health"
                  element={
                    <LazyPage>
                      <SettingsHealth />
                    </LazyPage>
                  }
                />
                <Route
                  path="stress-test"
                  element={
                    <LazyPage>
                      <StressTest />
                    </LazyPage>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/stats" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
