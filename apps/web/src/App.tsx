import { lazy, Suspense, useState, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ErrorBoundary from "#components/ErrorBoundary";
import ScrollRestoration from "#layout/ScrollRestoration";
import CommandPalette from "#components/CommandPalette";
import KeyboardShortcutsHelp from "#components/KeyboardShortcutsHelp";
import useDocumentTitle from "#hooks/useDocumentTitle";
import useKeyboardShortcuts from "#hooks/useKeyboardShortcuts";
import useMigrationCompletionInvalidator from "#hooks/useMigrationCompletionInvalidator";
import Settings from "#pages/Settings/Settings";
import Sidebar from "#layout/Sidebar";
import BottomNav from "#layout/BottomNav";
import { PageSkeleton } from "#components/Skeleton";

const Stats = lazy(() => import("#pages/Stats"));
const SettingsPlex = lazy(() => import("#pages/Settings/SettingsPlex"));
const SettingsAi = lazy(() => import("#pages/Settings/SettingsAi"));
const SettingsArrs = lazy(() => import("#pages/Settings/SettingsArrs"));
const SettingsDatabases = lazy(() => import("#pages/Settings/SettingsDatabases"));
const SettingsNotifications = lazy(() => import("#pages/Settings/Notifications/SettingsNotifications"));
const SettingsNotificationsService = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsService"));
const SettingsHealth = lazy(() => import("#pages/Settings/SettingsHealth"));
const SettingsMaintenance = lazy(() => import("#pages/Settings/SettingsMaintenance"));
const SettingsPersonalization = lazy(() => import("#pages/Settings/SettingsPersonalization"));
const SettingsPortal = lazy(() => import("#pages/Settings/SettingsPortal"));
const Collections = lazy(() => import("#pages/Collections"));
const CollectionDetail = lazy(() => import("#pages/CollectionDetail"));
const Rules = lazy(() => import("#pages/Rules"));
const Media = lazy(() => import("#pages/Media"));
const MediaDetail = lazy(() => import("#pages/MediaDetail"));
const Jobs = lazy(() => import("#pages/Jobs"));
const JobDetail = lazy(() => import("#pages/Jobs/JobDetail"));
const JobRun = lazy(() => import("#pages/Jobs/JobRun"));
const Users = lazy(() => import("#pages/Users"));
const Overlays = lazy(() => import("#pages/Overlays"));
const Events = lazy(() => import("#pages/Events"));
const StressTest = lazy(() => import("#pages/StressTest"));
const Preview = lazy(() => import("#pages/Preview"));
const Changelog = lazy(() => import("#pages/Changelog"));
const SettingsAbout = lazy(() => import("#pages/Settings/SettingsAbout"));
const SettingsPosters = lazy(() => import("#pages/Settings/SettingsPosters"));
const SettingsCredits = lazy(() => import("#pages/Settings/SettingsCredits"));
const SettingsMigrate = lazy(() => import("#pages/SettingsMigrate"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <div className="animated-page">{children}</div>
    </Suspense>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = useState<string>("");
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const openPalette = useCallback((initialQuery = "") => {
    setPaletteInitialQuery(initialQuery);
    setCommandPaletteOpen(true);
  }, []);

  useDocumentTitle();
  useKeyboardShortcuts(setShortcutsHelpOpen, openPalette);
  useMigrationCompletionInvalidator();

  return (
    <div className="layout">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
        {sidebarOpen ? "✕" : "☰"}
      </button>
      <div className={`sidebar-overlay ${sidebarOpen ? "sidebar-overlay-visible" : ""}`} onClick={closeSidebar} />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} onOpenPalette={openPalette} />
      <BottomNav />
      <main className="content">
        <ScrollRestoration />
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
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
                path="/preview"
                element={
                  <LazyPage>
                    <Preview />
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
                    path=":service"
                    element={
                      <LazyPage>
                        <SettingsNotificationsService />
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
                  path="maintenance"
                  element={
                    <LazyPage>
                      <SettingsMaintenance />
                    </LazyPage>
                  }
                />
                <Route
                  path="personalization"
                  element={
                    <LazyPage>
                      <SettingsPersonalization />
                    </LazyPage>
                  }
                />
                <Route
                  path="portal"
                  element={
                    <LazyPage>
                      <SettingsPortal />
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
                <Route
                  path="posters"
                  element={
                    <LazyPage>
                      <SettingsPosters />
                    </LazyPage>
                  }
                />
                <Route
                  path="migrate"
                  element={
                    <LazyPage>
                      <SettingsMigrate />
                    </LazyPage>
                  }
                />
                <Route
                  path="credits"
                  element={
                    <LazyPage>
                      <SettingsCredits />
                    </LazyPage>
                  }
                />
                <Route
                  path="about"
                  element={
                    <LazyPage>
                      <SettingsAbout />
                    </LazyPage>
                  }
                />
              </Route>
              <Route
                path="/changelog"
                element={
                  <LazyPage>
                    <Changelog />
                  </LazyPage>
                }
              />
              <Route path="*" element={<Navigate to="/stats" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <CommandPalette
        open={commandPaletteOpen}
        initialQuery={paletteInitialQuery}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <KeyboardShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
    </div>
  );
}
