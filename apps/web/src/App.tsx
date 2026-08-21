import { lazy, Suspense, useState, useCallback } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "#components/ErrorBoundary";
import ScrollRestoration from "#layout/ScrollRestoration";
import { AppBarProvider } from "#layout/AppBar";
import CommandPalette from "#components/CommandPalette";
import AuthBanner from "#/auth/AuthBanner";
import OnboardingBanner from "#components/OnboardingBanner";
import useOnboardingRedirect from "#hooks/useOnboardingRedirect";
import KeyboardShortcutsHelp from "#components/KeyboardShortcutsHelp";
import RouteAnnouncer, { RouteReady } from "#components/RouteAnnouncer";
import useDocumentTitle from "#hooks/useDocumentTitle";
import useKeyboardShortcuts from "#hooks/useKeyboardShortcuts";
import useMigrationCompletionInvalidator from "#hooks/useMigrationCompletionInvalidator";
import useThemeConfigSync from "#hooks/useThemeConfigSync";
import { NavMenuProvider } from "#hooks/useNavMenu";
import Settings from "#pages/Settings/Settings";
import Sidebar from "#layout/Sidebar";
import BottomNav from "#layout/BottomNav";
import { PageSkeleton } from "#components/Skeleton";

const Stats = lazy(() => import("#pages/Stats"));
const SettingsPlex = lazy(() => import("#pages/Settings/SettingsPlex"));
const SettingsAi = lazy(() => import("#pages/Settings/SettingsAi"));
const SettingsArrs = lazy(() => import("#pages/Settings/Arrs/SettingsArrs"));
const SettingsArrsService = lazy(() => import("#pages/Settings/Arrs/SettingsArrsService"));
const SettingsArrsInstances = lazy(() => import("#pages/Settings/Arrs/SettingsArrsInstances"));
const SettingsDatabases = lazy(() => import("#pages/Settings/Databases/SettingsDatabases"));
const SettingsDatabasesService = lazy(() => import("#pages/Settings/Databases/SettingsDatabasesService"));
const SettingsNotifications = lazy(() => import("#pages/Settings/Notifications/SettingsNotifications"));
const SettingsNotificationsService = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsService"));
const SettingsNotificationsDelivery = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsDelivery"));
const SettingsNotificationsRouting = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsRouting"));
const SettingsBandwidth = lazy(() => import("#pages/Settings/SettingsBandwidth"));
const SettingsHealth = lazy(() => import("#pages/Settings/SettingsHealth"));
const SettingsCleanup = lazy(() => import("#pages/Settings/SettingsCleanup"));
const SettingsMetadata = lazy(() => import("#pages/Settings/SettingsMetadata"));
const SettingsDigest = lazy(() => import("#pages/Settings/SettingsDigest"));
const SettingsWatchlist = lazy(() => import("#pages/Settings/SettingsWatchlist"));
const SettingsMaintenance = lazy(() => import("#pages/Settings/SettingsMaintenance"));
const SettingsBackup = lazy(() => import("#pages/Settings/SettingsBackup"));
const SettingsHistory = lazy(() => import("#pages/Settings/SettingsHistory"));
const SettingsSecurity = lazy(() => import("#pages/Settings/SettingsSecurity"));
const SettingsSchedules = lazy(() => import("#pages/Settings/SettingsSchedules"));
const SettingsPortal = lazy(() => import("#pages/Settings/Portal/SettingsPortal"));
const SettingsPortalPersonalization = lazy(() => import("#pages/Settings/Portal/SettingsPortalPersonalization"));
const SettingsPortalAppearance = lazy(() => import("#pages/Settings/Portal/SettingsPortalAppearance"));
const Collections = lazy(() => import("#pages/Collections"));
const RuleRuns = lazy(() => import("#pages/Rules/RuleRuns"));
const CollectionDetail = lazy(() => import("#pages/CollectionDetail"));
const CollectionItems = lazy(() => import("#pages/CollectionDetail/Items"));
const CollectionDetails = lazy(() => import("#pages/CollectionDetail/Details"));
const CollectionActivity = lazy(() => import("#pages/CollectionDetail/Activity"));
const Rules = lazy(() => import("#pages/Rules"));
const Cleanup = lazy(() => import("#pages/Cleanup"));
const CleanupLayout = lazy(() => import("#pages/CleanupLayout"));
const CleanupProtected = lazy(() => import("#pages/CleanupProtected"));
const Registry = lazy(() => import("#pages/Registry"));
const Media = lazy(() => import("#pages/Media"));
const MediaDetail = lazy(() => import("#pages/MediaDetail"));
const Duplicates = lazy(() => import("#pages/Duplicates"));
const ArrLibrary = lazy(() => import("#pages/Arr/ArrLibrary"));
const ArrInstances = lazy(() => import("#pages/Arr/ArrInstances"));
const ArrHealth = lazy(() => import("#pages/Arr/ArrHealth"));
const ArrDownloads = lazy(() => import("#pages/Arr/ArrDownloads"));
const ArrItemDetail = lazy(() => import("#pages/Arr/ArrItemDetail"));
const Discover = lazy(() => import("#pages/Discover/Discover"));
const Jobs = lazy(() => import("#pages/Jobs"));
const JobDetail = lazy(() => import("#pages/Jobs/JobDetail"));
const JobRun = lazy(() => import("#pages/Jobs/JobRun"));
const Users = lazy(() => import("#pages/Users"));
const UserDetail = lazy(() => import("#pages/UserDetail"));
const UserAccess = lazy(() => import("#pages/UserDetail/Access"));
const UserActivity = lazy(() => import("#pages/UserDetail/Activity"));
const UserSessions = lazy(() => import("#pages/UserDetail/Sessions"));
const Overlays = lazy(() => import("#pages/Overlays"));
const Prerolls = lazy(() => import("#pages/Prerolls"));
const Events = lazy(() => import("#pages/Events"));
const Changes = lazy(() => import("#pages/Changes"));
const StressTest = lazy(() => import("#pages/StressTest"));
const Preview = lazy(() => import("#pages/Preview"));
const Changelog = lazy(() => import("#pages/Changelog"));
const More = lazy(() => import("#pages/More"));
const SettingsPosters = lazy(() => import("#pages/Settings/SettingsPosters"));
const SettingsAppearance = lazy(() => import("#pages/Settings/SettingsAppearance"));
const SettingsPrerolls = lazy(() => import("#pages/Settings/SettingsPrerolls"));
const SettingsCredits = lazy(() => import("#pages/Settings/SettingsCredits"));
const SettingsMigrate = lazy(() => import("#pages/SettingsMigrate"));
const Onboarding = lazy(() => import("#pages/Onboarding"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <div className="animated-page">{children}</div>
    </Suspense>
  );
}

export default function App() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = useState<string>("");
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const location = useLocation();

  const openPalette = useCallback((initialQuery = "") => {
    setPaletteInitialQuery(initialQuery);
    setCommandPaletteOpen(true);
  }, []);

  useDocumentTitle();
  useKeyboardShortcuts(setShortcutsHelpOpen, openPalette);
  useMigrationCompletionInvalidator();
  useOnboardingRedirect();
  useThemeConfigSync();

  /**
   * Setup renders outside the app shell — no sidebar, no bottom nav, no app
   * bar. Handled here rather than as a route because those three are siblings
   * of `<Routes>`, not children of it, so there is no route-level way to opt
   * out of them.
   */
  if (location.pathname === "/onboarding") {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageSkeleton />}>
          <Onboarding />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    // The menu layout wraps the whole shell, not just the sidebar: the tab bar
    // and the /more page edit the same thing the sidebar does, and all three
    // have to move together while somebody is rearranging them.
    <NavMenuProvider>
      <div className="layout">
        {/* First in the DOM, so it is first in the tab order. */}
        <a className="skip-link" href="#page-content">
          Skip to content
        </a>
        <RouteAnnouncer />
        <Sidebar onOpenPalette={openPalette} />
        <BottomNav />
        {/* `tabIndex={-1}` so the skip link can actually move focus here: an
          anchor to a non-focusable target scrolls the page and leaves the tab
          order where it was, which is the failure mode that makes skip links
          look like they work and not work. */}
        <main className="content" id="page-content" tabIndex={-1}>
          <ScrollRestoration />
          {/* Above the AppBarProvider, so it sits over the breadcrumb rather than
            between it and the page: this is server-wide chrome, not a message
            about whatever page you happen to be on. */}
          <AuthBanner />
          <OnboardingBanner />
          <AppBarProvider>
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
                  >
                    <Route index element={<CollectionItems />} />
                    <Route path="details" element={<CollectionDetails />} />
                    <Route path="activity" element={<CollectionActivity />} />
                  </Route>
                  <Route
                    path="/rules"
                    element={
                      <LazyPage>
                        <Rules />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/rules/:ruleId/runs"
                    element={
                      <LazyPage>
                        <RuleRuns />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/cleanup"
                    element={
                      <LazyPage>
                        <CleanupLayout />
                      </LazyPage>
                    }
                  >
                    <Route index element={<Cleanup />} />
                    <Route path="rules" element={<Rules outcome="cleanup" />} />
                    <Route path="rules/:ruleId/runs" element={<RuleRuns outcome="cleanup" />} />
                    <Route path="protected" element={<CleanupProtected />} />
                  </Route>
                  {/* No layout of its own: a metadata rule's history lives in
                    Settings → Metadata, where the master switch and the undo
                    are, so there is no second tab to put beside the rules. */}
                  <Route path="/metadata" element={<Rules outcome="metadata" />} />
                  <Route path="/metadata/rules/:ruleId/runs" element={<RuleRuns outcome="metadata" />} />
                  <Route
                    path="/registry"
                    element={
                      <LazyPage>
                        <Registry />
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
                    path="/duplicates"
                    element={
                      <LazyPage>
                        <Duplicates />
                      </LazyPage>
                    }
                  />
                  {/* Managers. `/movies` and `/tv` are the same component with a
                    different service — the divergence between Radarr and Sonarr
                    is real, but it lives below this, in what the columns mean. */}
                  <Route
                    path="/discover"
                    element={
                      <LazyPage>
                        <Discover />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/movies"
                    element={
                      <LazyPage>
                        <ArrLibrary service="radarr" />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/tv"
                    element={
                      <LazyPage>
                        <ArrLibrary service="sonarr" />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/downloads"
                    element={
                      <LazyPage>
                        <ArrDownloads />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/arrs"
                    element={
                      <LazyPage>
                        <ArrInstances />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/arrs/health"
                    element={
                      <LazyPage>
                        <ArrHealth />
                      </LazyPage>
                    }
                  />
                  {/* The record pages `/movies` and `/tv` have always linked to.
                    They are listed after `/arrs/health` so the literal segment
                    still wins over `:instanceId`. */}
                  <Route
                    path="/arrs/:instanceId/movies/:arrId"
                    element={
                      <LazyPage>
                        <ArrItemDetail service="radarr" />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/arrs/:instanceId/series/:arrId"
                    element={
                      <LazyPage>
                        <ArrItemDetail service="sonarr" />
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
                    path="/prerolls"
                    element={
                      <LazyPage>
                        <Prerolls />
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
                    path="/users/:userId"
                    element={
                      <LazyPage>
                        <UserDetail />
                      </LazyPage>
                    }
                  >
                    <Route index element={<UserAccess />} />
                    <Route path="activity" element={<UserActivity />} />
                    <Route path="sessions" element={<UserSessions />} />
                  </Route>
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
                    >
                      <Route index element={<Navigate to="/settings/arrs/radarr" replace />} />
                      {/* Ahead of `:service`, which would otherwise match it. */}
                      <Route
                        path="instances"
                        element={
                          <LazyPage>
                            <SettingsArrsInstances />
                          </LazyPage>
                        }
                      />
                      <Route
                        path=":service"
                        element={
                          <LazyPage>
                            <SettingsArrsService />
                          </LazyPage>
                        }
                      />
                    </Route>
                    <Route
                      path="databases"
                      element={
                        <LazyPage>
                          <SettingsDatabases />
                        </LazyPage>
                      }
                    >
                      <Route index element={<Navigate to="/settings/databases/omdb" replace />} />
                      <Route
                        path=":service"
                        element={
                          <LazyPage>
                            <SettingsDatabasesService />
                          </LazyPage>
                        }
                      />
                    </Route>
                    <Route
                      path="notifications"
                      element={
                        <LazyPage>
                          <SettingsNotifications />
                        </LazyPage>
                      }
                    >
                      <Route index element={<Navigate to="/settings/notifications/routing" replace />} />
                      {/* Ahead of `:service`, which would otherwise match them. */}
                      <Route
                        path="routing"
                        element={
                          <LazyPage>
                            <SettingsNotificationsRouting />
                          </LazyPage>
                        }
                      />
                      <Route
                        path="delivery"
                        element={
                          <LazyPage>
                            <SettingsNotificationsDelivery />
                          </LazyPage>
                        }
                      />
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
                      path="bandwidth"
                      element={
                        <LazyPage>
                          <SettingsBandwidth />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="schedules"
                      element={
                        <LazyPage>
                          <SettingsSchedules />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="cleanup"
                      element={
                        <LazyPage>
                          <SettingsCleanup />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="metadata"
                      element={
                        <LazyPage>
                          <SettingsMetadata />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="digest"
                      element={
                        <LazyPage>
                          <SettingsDigest />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="watchlist"
                      element={
                        <LazyPage>
                          <SettingsWatchlist />
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
                      path="backup"
                      element={
                        <LazyPage>
                          <SettingsBackup />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="history"
                      element={
                        <LazyPage>
                          <SettingsHistory />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="security"
                      element={
                        <LazyPage>
                          <SettingsSecurity />
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
                    >
                      <Route index element={<Navigate to="/settings/portal/personalization" replace />} />
                      <Route
                        path="personalization"
                        element={
                          <LazyPage>
                            <SettingsPortalPersonalization />
                          </LazyPage>
                        }
                      />
                      <Route
                        path="appearance"
                        element={
                          <LazyPage>
                            <SettingsPortalAppearance />
                          </LazyPage>
                        }
                      />
                    </Route>
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
                      path="appearance"
                      element={
                        <LazyPage>
                          <SettingsAppearance />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="prerolls"
                      element={
                        <LazyPage>
                          <SettingsPrerolls />
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
                      path="changelog"
                      element={
                        <LazyPage>
                          <Changelog />
                        </LazyPage>
                      }
                    />
                  </Route>
                  {/* The changelog used to be a top-level page. Redirected rather
                    than dropped: the sidebar's version pill has pointed here
                    since the first release, so the path is in people's history
                    and bookmarks. */}
                  <Route path="/changelog" element={<Navigate to="/settings/changelog" replace />} />
                  <Route
                    path="/more"
                    element={
                      <LazyPage>
                        <More />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/changes"
                    element={
                      <LazyPage>
                        <Changes />
                      </LazyPage>
                    }
                  />
                  <Route path="*" element={<Navigate to="/stats" replace />} />
                </Routes>
                {/* Inside the boundary on purpose — it announces "loaded", and
                  from out here it would say so while the skeleton was up. */}
                <RouteReady />
              </Suspense>
            </ErrorBoundary>
          </AppBarProvider>
        </main>
        <CommandPalette
          open={commandPaletteOpen}
          initialQuery={paletteInitialQuery}
          onClose={() => setCommandPaletteOpen(false)}
        />
        <KeyboardShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
      </div>
    </NavMenuProvider>
  );
}
