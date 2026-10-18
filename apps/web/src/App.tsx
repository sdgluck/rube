import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "#components/ErrorBoundary";
import { useIsPhone } from "#hooks/useMediaQuery";
import { OPEN_SEARCH_EVENT } from "#lib/openSearch";
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
import useUiScaleConfigSync from "#hooks/useUiScaleConfigSync";
import { NavMenuProvider } from "#hooks/useNavMenu";
import Settings from "#pages/Settings/Settings";
import Sidebar from "#layout/Sidebar";
import { PageSkeleton } from "#components/Skeleton";

const Stats = lazy(() => import("#pages/Stats"));
const SettingsPlex = lazy(() => import("#pages/Settings/SettingsPlex"));
const SettingsAi = lazy(() => import("#pages/Settings/SettingsAi"));
const SettingsArrs = lazy(() => import("#pages/Settings/Arrs/SettingsArrs"));
const SettingsArrsService = lazy(() => import("#pages/Settings/Arrs/SettingsArrsService"));
const SettingsArrsInstances = lazy(() => import("#pages/Settings/Arrs/SettingsArrsInstances"));
const SettingsDownloadClients = lazy(() => import("#pages/Settings/Arrs/SettingsDownloadClients"));
const SettingsDatabases = lazy(() => import("#pages/Settings/Databases/SettingsDatabases"));
const SettingsDatabasesService = lazy(() => import("#pages/Settings/Databases/SettingsDatabasesService"));
const SettingsNotifications = lazy(() => import("#pages/Settings/Notifications/SettingsNotifications"));
const SettingsNotificationsService = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsService"));
const SettingsNotificationsDelivery = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsDelivery"));
const SettingsNotificationsRouting = lazy(() => import("#pages/Settings/Notifications/SettingsNotificationsRouting"));
const SettingsBandwidth = lazy(() => import("#pages/Settings/SettingsBandwidth"));
const SettingsHealth = lazy(() => import("#pages/Settings/SettingsHealth"));
const SettingsCleanup = lazy(() => import("#pages/Settings/SettingsCleanup"));
const SettingsHomeAssistant = lazy(() => import("#pages/Settings/SettingsHomeAssistant"));
const SettingsMetadata = lazy(() => import("#pages/Settings/SettingsMetadata"));
const SettingsDigest = lazy(() => import("#pages/Settings/SettingsDigest"));
const SettingsWatchlist = lazy(() => import("#pages/Settings/SettingsWatchlist"));
const SettingsMaintenance = lazy(() => import("#pages/Settings/SettingsMaintenance"));
const SettingsBackup = lazy(() => import("#pages/Settings/SettingsBackup"));
const SettingsHistory = lazy(() => import("#pages/Settings/SettingsHistory"));
const SettingsSecurity = lazy(() => import("#pages/Settings/SettingsSecurity"));
const SettingsApi = lazy(() => import("#pages/Settings/SettingsApi"));
const SettingsMobile = lazy(() => import("#pages/Settings/SettingsMobile"));
const SettingsIndex = lazy(() => import("#pages/Settings/SettingsIndex"));
const SettingsPortal = lazy(() => import("#pages/Settings/Portal/SettingsPortal"));
const SettingsPortalPersonalization = lazy(() => import("#pages/Settings/Portal/SettingsPortalPersonalization"));
const SettingsPortalComponents = lazy(() => import("#pages/Settings/Portal/SettingsPortalComponents"));
const SettingsPortalAppearance = lazy(() => import("#pages/Settings/Portal/SettingsPortalAppearance"));
const SettingsPortalMatch = lazy(() => import("#pages/Settings/Portal/SettingsPortalMatch"));
const SettingsPortalAddress = lazy(() => import("#pages/Settings/Portal/SettingsPortalAddress"));
const SettingsPortalPreroll = lazy(() => import("#pages/Settings/Portal/SettingsPortalPreroll"));
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
const Problems = lazy(() => import("#pages/Problems/Problems"));
const ProblemKind = lazy(() => import("#pages/Problems/ProblemKind"));
const ArrLibrary = lazy(() => import("#pages/Arr/ArrLibrary"));
const ArrInstances = lazy(() => import("#pages/Arr/ArrInstances"));
const ArrDownloads = lazy(() => import("#pages/Arr/ArrDownloads"));
const UnusedFourK = lazy(() => import("#pages/Arr/UnusedFourK"));
const ArrItemDetail = lazy(() => import("#pages/Arr/ArrItemDetail"));
const ArrInstanceDetail = lazy(() => import("#pages/Arr/ArrInstanceDetail"));
const Discover = lazy(() => import("#pages/Discover/Discover"));
const Jobs = lazy(() => import("#pages/Jobs"));
const JobsLayout = lazy(() => import("#pages/Jobs/JobsLayout"));
const JobSchedule = lazy(() => import("#pages/Jobs/Schedule"));
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

  const isPhone = useIsPhone();
  const drawer = useDrawer(isPhone, location.pathname);

  useEffect(() => {
    const onOpen = () => {
      drawer.close();
      openPalette();
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
  }, [openPalette, drawer.close]);

  useDocumentTitle();
  useKeyboardShortcuts(setShortcutsHelpOpen, openPalette);
  useMigrationCompletionInvalidator();
  useOnboardingRedirect();
  useThemeConfigSync();
  useUiScaleConfigSync();

  /**
   * Setup renders outside the app shell — no sidebar and no app bar. Handled here rather than as a route because those three are siblings
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
    // The menu layout wraps the whole shell, not just the sidebar, so the
    // sidebar's editor and anything else reading the menu move together while
    // somebody is rearranging it.
    <NavMenuProvider>
      <div className="layout" data-drawer={drawer.open ? "open" : undefined}>
        {/* First in the DOM, so it is first in the tab order. */}
        <a className="skip-link" href="#page-content">
          Skip to content
        </a>
        <RouteAnnouncer />
        <Sidebar
          onOpenPalette={() => {
            drawer.close();
            openPalette();
          }}
          // Off-canvas and closed: out of the tab order and the accessibility
          // tree, not merely off-screen, or Tab walks through forty links the
          // user can't see.
          inert={isPhone && !drawer.open}
        />
        {/* Below --bp-md the sidebar is a drawer; this is what a tap outside
          it lands on. Rendered only while open, so it can't catch a tap. */}
        {isPhone && drawer.open && <div className="drawer-scrim" onClick={drawer.close} aria-hidden="true" />}
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
          <AppBarProvider onOpenMenu={isPhone ? drawer.toggle : undefined} menuOpen={drawer.open}>
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
                    path="/problems"
                    element={
                      <LazyPage>
                        <Problems />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/problems/:kind"
                    element={
                      <LazyPage>
                        <ProblemKind />
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
                    path="/movies/unused-4k"
                    element={
                      <LazyPage>
                        <UnusedFourK />
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
                  {/* Reconciliation moved into Problems. Kept so an old bookmark,
                    and the literal segment's precedence over `:instanceId`,
                    still work. */}
                  <Route path="/arrs/health" element={<Navigate to="/problems" replace />} />
                  <Route
                    path="/arrs/:instanceId"
                    element={
                      <LazyPage>
                        <ArrInstanceDetail />
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
                        <JobsLayout />
                      </LazyPage>
                    }
                  >
                    <Route index element={<Jobs />} />
                    <Route path="schedule" element={<JobSchedule />} />
                  </Route>
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
                    <Route index element={<SettingsIndex />} />
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
                        path="download-clients"
                        element={
                          <LazyPage>
                            <SettingsDownloadClients />
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
                    {/* Moved to Jobs → Schedule, beside the timeline it governs. */}
                    <Route path="schedules" element={<Navigate to="/jobs/schedule" replace />} />
                    <Route
                      path="cleanup"
                      element={
                        <LazyPage>
                          <SettingsCleanup />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="home-assistant"
                      element={
                        <LazyPage>
                          <SettingsHomeAssistant />
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
                      path="api"
                      element={
                        <LazyPage>
                          <SettingsApi />
                        </LazyPage>
                      }
                    />
                    <Route
                      path="mobile"
                      element={
                        <LazyPage>
                          <SettingsMobile />
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
                        path="address"
                        element={
                          <LazyPage>
                            <SettingsPortalAddress />
                          </LazyPage>
                        }
                      />
                      <Route
                        path="personalization"
                        element={
                          <LazyPage>
                            <SettingsPortalPersonalization />
                          </LazyPage>
                        }
                      />
                      <Route
                        path="components"
                        element={
                          <LazyPage>
                            <SettingsPortalComponents />
                          </LazyPage>
                        }
                      />
                      <Route
                        path="match"
                        element={
                          <LazyPage>
                            <SettingsPortalMatch />
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
                      <Route
                        path="preroll"
                        element={
                          <LazyPage>
                            <SettingsPortalPreroll />
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

/**
 * The sidebar as an off-canvas drawer below --bp-md.
 *
 * Opened from the app bar's menu button; closed by the scrim, Escape, or any
 * navigation — a drawer left open over the page you just picked from it is the
 * one way this goes wrong. Leaving the phone layout closes it too, so widening
 * the window can't strand an "open" flag that reappears on the next narrowing.
 * Focus goes into the drawer on open and back to whatever opened it on close.
 */
function useDrawer(isPhone: boolean, pathname: string) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => setOpen(false), [pathname, isPhone]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>(".sidebar a, .sidebar button")?.focus({ preventScroll: true });
    // The document scrolls on a phone; without this a swipe on the drawer
    // scrolls the page behind it.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return { open, close, toggle };
}
