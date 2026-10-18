/**
 * The procedures the native app calls, and the schema each one answers with.
 *
 * This is the whole contract between the server and the Swift/Kotlin clients.
 * Every entry is attached in its router with `.output()` (the same object —
 * `native-api.test.ts` checks identity, not likeness), and `native-codegen`
 * reads the routers for inputs and this map for outputs to write the native
 * models. `null` is a procedure that answers nothing.
 *
 * Adding a screen to the app that needs another procedure: add its output
 * schema to `portal.ts`/`admin.ts`, list it here, attach it, then run
 * `pnpm native:codegen`. Removing one here before the app stops calling it
 * breaks installed apps — the server keeps answering, but nothing checks the
 * shape any more.
 */
import * as admin from "./admin.ts";
import * as portal from "./portal.ts";

export * from "./shared.ts";
export { int } from "./int.ts";
export { admin as NativeAdmin, portal as NativePortal };

export const NATIVE_PROCEDURES = {
  portal: {
    "auth.server": portal.AuthServerOutput,
    "auth.exchange": portal.AuthExchangeOutput,
    "auth.logout": portal.AuthLogoutOutput,
    branding: portal.BrandingOutput,
    personalizationStatus: portal.PersonalizationStatusOutput,
    me: portal.MeOutput,
    components: portal.ComponentsOutput,
    "preferences.get": portal.PreferencesGetOutput,
    "preferences.set": portal.PreferencesSetOutput,
    myCollections: portal.MyCollectionsOutput,
    notInterested: portal.NotInterestedOutput,
    leavingSoon: portal.LeavingSoonOutput,
    voteKeep: portal.VoteKeepOutput,
    myWatchSummary: portal.MyWatchSummaryOutput,
    searchTitles: portal.SearchTitlesOutput,
    availableGenres: portal.AvailableGenresOutput,
    "match.libraries": portal.MatchLibrariesOutput,
    "match.genres": portal.MatchGenresOutput,
    "match.presets": portal.MatchPresetsOutput,
    "match.count": portal.MatchCountOutput,
    "match.create": portal.MatchCreateOutput,
    "match.rooms": portal.MatchRoomsOutput,
    "match.join": portal.MatchJoinOutput,
    "match.state": portal.MatchStateOutput,
    "match.deck": portal.MatchDeckOutput,
    "match.swipe": portal.MatchSwipeOutput,
    "match.undo": null,
    "match.reset": null,
    "match.vote": null,
    "match.leave": null,
    "match.guest.preview": portal.MatchGuestPreviewOutput,
    "match.guest.join": portal.MatchGuestJoinOutput,
  },
  admin: {
    "auth.status": admin.AuthStatusOutput,
    "auth.server": admin.AuthServerOutput,
    "auth.exchange": admin.AuthExchangeOutput,
    "auth.logout": admin.AuthLogoutOutput,
    "stats.overview": admin.StatsOverviewOutput,
    "stats.activity": admin.StatsActivityOutput,
    "stats.sessions": admin.StatsSessionsOutput,
    "stats.recentlyAdded": admin.StatsRecentlyAddedOutput,
    "stats.ops": admin.StatsOpsOutput,
    "health.status": admin.HealthStatusOutput,
    "health.check": admin.HealthCheckOutput,
    "problems.list": admin.ProblemsListOutput,
    "problems.fix": admin.ProblemsFixOutput,
    "problems.fixAll": admin.ProblemsFixAllOutput,
    "problems.dismiss": null,
    "problems.undismiss": null,
    "problems.rescan": admin.ProblemsRescanOutput,
    "nav.metrics": admin.NavMetricsOutput,
    "events.list": admin.EventsListOutput,
    "jobs.list": admin.JobsListOutput,
    "jobs.activeRuns": admin.JobsActiveRunsOutput,
    "jobs.recentRuns": admin.JobsRecentRunsOutput,
    "jobs.runs": admin.JobsRunsOutput,
    "jobs.run": admin.JobsRunOutput,
    "jobs.runLog": admin.JobsRunLogOutput,
    "jobs.fullLog": admin.JobsFullLogOutput,
    "jobs.lastFailure": admin.JobsLastFailureOutput,
    "jobs.start": admin.JobsStartOutput,
    "jobs.cancel": admin.JobsCancelOutput,
    "rules.list": admin.RulesListOutput,
    "rules.run": admin.RulesRunOutput,
    "rules.cancelRun": admin.RulesCancelRunOutput,
    "rules.activeRuns": admin.RulesActiveRunsOutput,
    "rules.runs": admin.RulesRunsOutput,
    "rules.recentRuns": admin.RulesRecentRunsOutput,
    "rules.runDetail": admin.RulesRunDetailOutput,
    "rules.runLog": admin.RulesRunLogOutput,
    "rules.runsForJobRun": admin.RulesRunsForJobRunOutput,
    "cleanup.queue": admin.CleanupQueueOutput,
    "cleanup.counts": admin.CleanupCountsOutput,
    "cleanup.approve": admin.CleanupApproveOutput,
    "cleanup.hold": admin.CleanupHoldOutput,
    "cleanup.holdMany": admin.CleanupHoldManyOutput,
    "cleanup.restoreHolds": admin.CleanupRestoreHoldsOutput,
    "cleanup.protections": admin.CleanupProtectionsOutput,
    "cleanup.protect": admin.CleanupProtectOutput,
    "cleanup.unprotect": admin.CleanupUnprotectOutput,
    "collections.list": admin.CollectionsListOutput,
    "collections.get": admin.CollectionsGetOutput,
    "collections.items": admin.CollectionsItemsOutput,
    "collections.stats": admin.CollectionsStatsOutput,
    "collections.syncOne": admin.CollectionsSyncOneOutput,
    "media.get": admin.MediaGetOutput,
    "media.why": admin.MediaWhyOutput,
    "media.children": admin.MediaChildrenOutput,
    "stats.watchedBy": admin.StatsWatchedByOutput,
    "users.list": admin.UsersListOutput,
    "users.get": admin.UsersGetOutput,
    "users.history": admin.UsersHistoryOutput,
    "users.sessions": admin.UsersSessionsOutput,
    "users.sync": admin.UsersSyncOutput,
    "users.terminateSession": admin.UsersTerminateSessionOutput,
    "stats.userPlayback": admin.StatsUserPlaybackOutput,
    "stats.allUserPlayback": admin.StatsAllUserPlaybackOutput,
    "stats.topUsers": admin.StatsTopUsersOutput,
    "stats.history": admin.StatsHistoryOutput,
  },
} as const;

export type NativeRouter = keyof typeof NATIVE_PROCEDURES;
