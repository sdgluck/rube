/**
 * Output schemas for the admin procedures the native app calls.
 *
 * Generated once from the routers' inferred output types and then owned by
 * hand: each is attached to its procedure with `.output()`, so the server
 * validates what it sends and tRPC types the resolver against it — a resolver
 * that drifts from its schema is a typecheck error, not a native decode
 * failure. `native-codegen` turns these into the Swift and Kotlin models.
 *
 * Rules for anything in here (`native-api.test.ts` and codegen enforce them):
 * JSON-representable only — no `z.date()`, bigint, transforms or custom
 * types; timestamps are epoch milliseconds. `int()` marks an integer for the
 * native models without validating it, so a wrong guess fails one app decode
 * rather than the endpoint.
 */
import { z } from "zod";
import { int } from "./int.ts";
import {
  RuleRunTrigger,
  RuleRunPhase,
  ProblemKind,
  PlexSession,
  UserSummary,
  RuleRunSummary,
  CollectionPerformance,
  ActiveJobRun,
  MediaRef,
  SignedIn,
  LogChunk,
  ValueCount,
  StatsCoverage,
} from "./shared.ts";

/** `auth.status` */
export const AuthStatusOutput = z.object({
  configured: z.boolean(),
  required: z.boolean(),
  disabledByEnv: z.boolean(),
  signedIn: z.boolean(),
  username: z.string().optional(),
  ownerResolved: z.boolean(),
  ownerUsername: z.string().optional(),
  allowedUserIds: z.array(z.number()).optional(),
});

/** `auth.server` */
export const AuthServerOutput = z.object({
  product: z.enum(["tinkerbell-admin", "tinkerbell-portal"]),
  version: z.string(),
  capabilities: z.array(z.literal("exchange")),
  authRequired: z.boolean(),
  portalUrl: z.string().nullable(),
});

/** `auth.exchange` */
export const AuthExchangeOutput = z.discriminatedUnion("status", [z.object({ status: z.literal("open") }), SignedIn]);

/** `auth.logout` */
export const AuthLogoutOutput = z.object({ ok: z.boolean() });

/** `stats.overview` */
export const StatsOverviewOutput = z.object({
  totalItems: int(),
  userCount: int(),
  resolutions: z.array(ValueCount),
  videoCodecs: z.array(ValueCount),
  audioCodecs: z.array(ValueCount),
  addedThisWeek: z.number(),
  movieCount: int(),
  showCount: int(),
  episodeCount: int(),
  count4k: z.number(),
});

/** `stats.activity` */
export const StatsActivityOutput = z.object({
  playsToday: z.number(),
  playsWeek: z.number(),
  activeUsersWeek: z.number(),
  topUserToday: z.object({ name: z.string(), plays: int() }).nullable(),
});

/** `stats.sessions` */
export const StatsSessionsOutput = z.array(PlexSession);

/** `stats.recentlyAdded` */
export const StatsRecentlyAddedOutput = z.object({
  items: z.array(
    z.object({
      ratingKey: z.string(),
      title: z.string(),
      year: int().optional(),
      thumb: z.string().optional(),
      type: z.string(),
      addedAt: int(),
      grandparentTitle: z.string().optional(),
      parentTitle: z.string().optional(),
      container: z.string().optional(),
      videoResolution: z.string().optional(),
      fileSize: z.number().optional(),
    }),
  ),
  jobEnabled: z.boolean(),
});

/** `stats.ops` */
export const StatsOpsOutput = z.object({
  failedJobs24h: z.number(),
  lastFailure: ActiveJobRun.nullable(),
  lastSyncAt: int().nullable(),
  uptimeSec: z.number(),
});

/** `health.status` */
export const HealthStatusOutput = z.array(
  z.object({
    service: z.string(),
    configured: z.boolean(),
    status: z.string().nullable(),
    message: z.string().nullable(),
    timestamp: int().nullable(),
    mutedUntil: z.number().nullable(),
  }),
);

/** `health.check` */
export const HealthCheckOutput = z.object({ ok: z.boolean() });

/** `problems.list` */
export const ProblemsListOutput = z.object({
  problems: z.array(
    z.object({
      kind: ProblemKind,
      subject: z.string(),
      title: z.string(),
      detail: z.string(),
      link: z.string().optional(),
      fixable: z.boolean(),
      fixLabel: z.string().optional(),
      evidence: z
        .object({
          seasons: z.array(z.object({ season: z.number(), compared: z.number(), mismatched: z.number() })),
          examples: z.array(z.object({ code: z.string(), plex: z.string(), sonarr: z.string() })),
          multiEpisodeFiles: z.number(),
        })
        .optional(),
      fixPending: z.boolean().optional(),
      fingerprint: z.string(),
      dismissed: z.boolean(),
    }),
  ),
  lastScannedAt: int().nullable(),
});

/** `problems.fix` */
export const ProblemsFixOutput = z.object({ message: z.string() });

/** `problems.fixAll` */
export const ProblemsFixAllOutput = z.object({
  fixed: z.number(),
  failed: z.array(z.object({ title: z.string(), error: z.string() })),
});

// problems.dismiss: no output (void)

// problems.undismiss: no output (void)

/** `problems.rescan` */
export const ProblemsRescanOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: z.string() }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["already-running", "not-found", "unknown-command", "unknown-variant"]),
    runId: z.string().optional(),
  }),
]);

/** `nav.metrics` */
export const NavMetricsOutput = z.object({
  collections: z.number(),
  media: z.number(),
  rules: z.number(),
  users: z.number(),
  prerolls: z.number(),
  eventsErrors24h: z.number(),
  cleanupDueSoon: z.number(),
  overlaysStatus: z.enum(["error", "ok"]).nullable(),
  jobsStatus: z.enum(["error", "ok"]).nullable(),
  arrQueue: z.number(),
  arrsStatus: z.enum(["error", "ok"]).nullable(),
  problems: z.number(),
});

/** `events.list` */
export const EventsListOutput = z.object({
  items: z.array(
    z.object({
      id: int(),
      type: z.string(),
      message: z.string(),
      metadata: z.record(z.string(), z.unknown()).nullable(),
      timestamp: int(),
      count: int(),
      avgDurationMs: z.number().nullable(),
    }),
  ),
  total: int(),
});

/** `jobs.list` */
export const JobsListOutput = z.array(
  z.object({
    lastRunStatus: z.string().nullable().optional(),
    lastRunStartedAt: int().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
    command: z.string(),
    config: z.record(z.string(), z.unknown()),
    enabled: int(),
    id: z.string(),
    name: z.string(),
    schedule: z.string(),
  }),
);

/** `jobs.activeRuns` */
export const JobsActiveRunsOutput = z.array(
  z.object({
    id: z.string(),
    jobId: z.string(),
    jobName: z.string(),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    startedAt: int(),
  }),
);

/** `jobs.recentRuns` */
export const JobsRecentRunsOutput = z.array(
  z.object({
    id: z.string(),
    jobId: z.string(),
    jobName: z.string(),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    startedAt: int(),
    finishedAt: int().nullable(),
  }),
);

/** `jobs.runs` */
export const JobsRunsOutput = z.array(
  z.object({
    failureKind: z.string().nullable(),
    finishedAt: int().nullable(),
    id: z.string(),
    jobId: z.string(),
    message: z.string(),
    progress: z.number(),
    startedAt: int(),
    status: z.string(),
    variant: z.string().nullable(),
  }),
);

/** `jobs.run` */
export const JobsRunOutput = z.object({
  jobName: z.string().nullable(),
  command: z.string().nullable(),
  failureKind: z.string().nullable(),
  finishedAt: int().nullable(),
  id: z.string(),
  jobId: z.string(),
  message: z.string(),
  progress: z.number(),
  startedAt: int(),
  status: z.string(),
  variant: z.string().nullable(),
});

/** `jobs.runLog` */
export const JobsRunLogOutput = LogChunk;

/** `jobs.fullLog` */
export const JobsFullLogOutput = z.object({ log: z.string() });

/** `jobs.lastFailure` */
export const JobsLastFailureOutput = ActiveJobRun.nullable();

/** `jobs.start` */
export const JobsStartOutput = z.object({ runId: z.string() });

/** `jobs.cancel` */
export const JobsCancelOutput = z.object({ ok: z.boolean() });

/** `rules.list` */
export const RulesListOutput = z.array(
  z.object({
    hasTestResult: z.boolean(),
    runCount: int(),
    lastRunId: z.string().nullable(),
    config: z.record(z.string(), z.unknown()),
    createdAt: int(),
    enabled: int(),
    id: z.string(),
    lastCollectionRatingKey: z.string().nullable(),
    lastPinnedCollections: z.record(z.string(), z.array(z.string())),
    lastRunArrAddedCount: int().nullable(),
    lastRunArrFailedCount: int().nullable(),
    lastRunArrSkippedCount: int().nullable(),
    lastRunAt: int().nullable(),
    lastRunCollectionCount: int().nullable(),
    lastRunDurationMs: z.number().nullable(),
    lastRunError: z.string().nullable(),
    lastRunItemCount: int().nullable(),
    lastRunStatus: z.string().nullable(),
    lastScheduledAt: int().nullable(),
    lastTestAt: int().nullable(),
    lastTestCollectionCount: int().nullable(),
    lastTestDurationMs: z.number().nullable(),
    lastTestError: z.string().nullable(),
    lastTestItemCount: int().nullable(),
    lastTestStatus: z.string().nullable(),
    name: z.string(),
    position: int(),
    registryConfigHash: z.string().nullable(),
    registryPackSlug: z.string().nullable(),
    registryRuleSlug: z.string().nullable(),
    registryVersion: z.number().nullable(),
    type: z.string(),
    windowClearedAt: int().nullable(),
  }),
);

/** `rules.run` */
export const RulesRunOutput = z.object({ runId: z.string(), attached: z.boolean() });

/** `rules.cancelRun` */
export const RulesCancelRunOutput = z.object({
  ok: z.boolean(),
  status: z.enum(["cancelled", "cancelling"]).nullable(),
});

/** `rules.activeRuns` */
export const RulesActiveRunsOutput = z.array(RuleRunSummary);

/** `rules.runs` */
export const RulesRunsOutput = z.array(
  z.object({
    id: z.string(),
    ruleId: z.string(),
    phase: RuleRunPhase,
    trigger: RuleRunTrigger,
    jobRunId: z.string().nullable(),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    collectionCount: int().nullable(),
    itemCount: int().nullable(),
    error: z.string().nullable(),
    startedAt: int(),
    updatedAt: int(),
    finishedAt: int().nullable(),
    hasFunnel: z.boolean(),
    changes: z.object({ added: z.number(), removed: z.number() }),
  }),
);

/** `rules.recentRuns` */
export const RulesRecentRunsOutput = z.array(RuleRunSummary);

/** `rules.runDetail` */
export const RulesRunDetailOutput = z
  .object({
    id: z.string(),
    ruleId: z.string(),
    phase: RuleRunPhase,
    trigger: RuleRunTrigger,
    jobRunId: z.string().nullable(),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    collectionCount: int().nullable(),
    itemCount: int().nullable(),
    error: z.string().nullable(),
    startedAt: int(),
    updatedAt: int(),
    finishedAt: int().nullable(),
    hasFunnel: z.boolean(),
  })
  .nullable();

/** `rules.runLog` */
export const RulesRunLogOutput = LogChunk;

/** `rules.runsForJobRun` */
export const RulesRunsForJobRunOutput = z.array(RuleRunSummary);

/** `cleanup.queue` */
export const CleanupQueueOutput = z.array(
  z.object({
    ruleId: z.string(),
    ratingKey: z.string(),
    sectionId: z.string(),
    title: z.string(),
    streak: z.number(),
    firstMatchedAt: int(),
    lastMatchedAt: int(),
    actionedAt: int().nullable(),
    action: z.string(),
    heldUntil: z.number().nullable(),
    approvedAt: int().nullable(),
    ruleName: z.string(),
    consecutiveRuns: z.number(),
    mode: z.string(),
    runsRemaining: int(),
    held: z.boolean(),
    fileSize: z.number().nullable(),
    isProtected: z.boolean(),
    keepVotes: z.array(z.string()),
    requiresApproval: z.boolean(),
    approved: z.boolean(),
    ruleEnabled: z.boolean(),
  }),
);

/** `cleanup.counts` */
export const CleanupCountsOutput = z.record(z.string(), z.object({ queued: z.number(), actioned: z.number() }));

/** `cleanup.approve` */
export const CleanupApproveOutput = z.object({ ok: z.literal(true) });

/** `cleanup.hold` */
export const CleanupHoldOutput = z.object({ ok: z.boolean() });

/** `cleanup.holdMany` */
export const CleanupHoldManyOutput = z.object({
  ok: z.literal(true),
  count: int(),
  previous: z.array(z.object({ ruleId: z.string(), ratingKey: z.string(), heldUntil: z.number().nullable() })),
});

/** `cleanup.restoreHolds` */
export const CleanupRestoreHoldsOutput = z.object({ ok: z.literal(true), count: int() });

/** `cleanup.protections` */
export const CleanupProtectionsOutput = z.array(
  z.object({ id: int(), kind: z.string(), value: z.string(), label: z.string(), note: z.string(), createdAt: int() }),
);

/** `cleanup.protect` */
export const CleanupProtectOutput = z.object({ ok: z.boolean() });

/** `cleanup.unprotect` */
export const CleanupUnprotectOutput = z.object({ ok: z.boolean() });

/** `collections.list` */
export const CollectionsListOutput = z.object({
  total: int(),
  items: z.array(
    z.object({
      performance: CollectionPerformance.nullable(),
      addedAt: int().nullable(),
      childCount: int(),
      labels: z.array(z.string()),
      plexRatingKey: z.string(),
      sectionId: z.string(),
      sectionTitle: z.string(),
      smart: z.number(),
      smartFilter: z.string(),
      summary: z.string(),
      syncedAt: int(),
      thumb: z.string(),
      title: z.string(),
    }),
  ),
  performanceWindow: StatsCoverage,
});

/** `collections.get` */
export const CollectionsGetOutput = z.object({
  addedAt: int().nullable(),
  childCount: int(),
  labels: z.array(z.string()),
  plexRatingKey: z.string(),
  sectionId: z.string(),
  sectionTitle: z.string(),
  smart: z.number(),
  smartFilter: z.string(),
  summary: z.string(),
  syncedAt: int(),
  thumb: z.string(),
  title: z.string(),
});

/** `collections.items` */
export const CollectionsItemsOutput = z.array(
  z.object({ ratingKey: z.string(), title: z.string(), year: int().optional(), thumb: z.string().optional() }),
);

/** `collections.stats` */
export const CollectionsStatsOutput = z.object({
  knownItems: int(),
  totalRuntimeMs: int(),
  yearRange: z.object({ from: z.number(), to: z.number() }).nullable(),
  topGenres: z.array(z.object({ genre: z.string(), count: int() })),
  watchedFraction: z.number().nullable(),
  performance: CollectionPerformance.nullable(),
  performanceWindow: StatsCoverage,
});

/** `collections.syncOne` */
export const CollectionsSyncOneOutput = z.object({ ok: z.literal(true) });

/** `media.get` */
export const MediaGetOutput = z.object({
  ratingKey: z.string(),
  title: z.string(),
  year: int().optional(),
  thumb: z.string().optional(),
  type: z.string(),
  addedAt: int().optional(),
  videoResolution: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  audioChannels: z.number().optional(),
  container: z.string().optional(),
  summary: z.string(),
  contentRating: z.string().optional(),
  duration: z.number().optional(),
  originallyAvailableAt: z.string().optional(),
  studio: z.string().optional(),
  rating: z.number().optional(),
  audienceRating: z.number().optional(),
  viewOffset: z.number().optional(),
  viewCount: int().optional(),
  genres: z.array(z.string()),
  directors: z.array(z.string()),
  guids: z.array(z.string()),
  media: z.array(
    z.object({
      videoResolution: z.string().optional(),
      videoCodec: z.string().optional(),
      videoFrameRate: z.string().optional(),
      videoProfile: z.string().optional(),
      audioCodec: z.string().optional(),
      audioChannels: z.number().optional(),
      container: z.string().optional(),
      bitrate: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      optimizedForStreaming: z.boolean().optional(),
      parts: z.array(
        z.object({
          key: z.string().optional(),
          file: z.string().optional(),
          size: z.number().optional(),
          container: z.string().optional(),
          duration: z.number().optional(),
          streams: z.array(
            z.object({
              streamType: z.number(),
              codec: z.string().optional(),
              displayTitle: z.string().optional(),
              bitrate: z.number().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              frameRate: z.number().optional(),
              profile: z.string().optional(),
              level: z.number().optional(),
              bitDepth: z.number().optional(),
              chromaSubsampling: z.string().optional(),
              colorPrimaries: z.string().optional(),
              colorRange: z.string().optional(),
              colorSpace: z.string().optional(),
              scanType: z.string().optional(),
              channels: z.number().optional(),
              audioChannelLayout: z.string().optional(),
              samplingRate: z.number().optional(),
              language: z.string().optional(),
              languageCode: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
  collections: z.array(MediaRef),
});

/** `media.why` */
export const MediaWhyOutput = z.array(
  z.object({
    collection: MediaRef,
    rule: z.object({ id: z.string(), name: z.string(), type: z.string() }).nullable(),
    criteria: z.string().nullable(),
  }),
);

/** `media.children` */
export const MediaChildrenOutput = z.array(
  z.object({
    ratingKey: z.string(),
    type: z.string(),
    title: z.string(),
    index: int().optional(),
    thumb: z.string().optional(),
    leafCount: int().optional(),
    year: int().optional(),
    videoResolution: z.string().optional(),
    videoCodec: z.string().optional(),
    audioCodec: z.string().optional(),
    audioChannels: z.number().optional(),
    container: z.string().optional(),
  }),
);

/** `stats.watchedBy` */
export const StatsWatchedByOutput = z.array(
  z.object({
    ratingKey: z.string(),
    userId: int(),
    plays: int(),
    completedPlays: z.number(),
    firstPlayedAt: int().nullable(),
    lastPlayedAt: int().nullable(),
    totalWatchedMs: int(),
    maxCompletionPct: z.number(),
    username: z.string(),
  }),
);

/** `users.list` */
export const UsersListOutput = z.object({ items: z.array(UserSummary), total: int(), offset: int(), limit: int() });

/** `users.get` */
export const UsersGetOutput = z.object({
  user: UserSummary,
  share: z
    .object({
      sharedServerId: int().nullable(),
      accepted: z.boolean(),
      allowSync: z.boolean(),
      allowTuners: z.boolean(),
      allowChannels: z.boolean(),
      allowCameraUpload: z.boolean(),
      librarySectionIds: z.array(z.number()),
      contentRatingMovies: z.array(z.string()),
      contentRatingTelevision: z.array(z.string()),
      labelsMovies: z.array(z.string()),
      labelsTelevision: z.array(z.string()),
    })
    .nullable(),
  sections: z.array(z.object({ key: z.string(), title: z.string(), type: z.string() })),
  personalization: z.object({ status: z.string(), ownsLabels: z.boolean() }),
});

/** `users.history` */
export const UsersHistoryOutput = z.array(
  z.object({
    type: z.string(),
    ratingKey: z.string(),
    title: z.string(),
    year: int().optional(),
    grandparentTitle: z.string().optional(),
    grandparentRatingKey: z.string().optional(),
    accountID: z.number().optional(),
    viewedAt: int().optional(),
    librarySectionID: z.string().optional(),
  }),
);

/** `users.sessions` */
export const UsersSessionsOutput = z.array(PlexSession);

/** `users.sync` */
export const UsersSyncOutput = z.object({ synced: z.number(), removed: z.number(), invites: z.number() });

/** `users.terminateSession` */
export const UsersTerminateSessionOutput = z.object({ ok: z.boolean() });

/** `stats.userPlayback` */
export const StatsUserPlaybackOutput = z.object({ plays: int(), watchedMs: z.number() });

/** `stats.allUserPlayback` */
export const StatsAllUserPlaybackOutput = z.array(z.object({ plays: int(), watchedMs: z.number(), userId: int() }));

/** `stats.topUsers` */
export const StatsTopUsersOutput = z.array(
  z.object({ userId: int(), name: z.string(), plays: int(), watchedMs: z.number(), lastPlayedAt: int().nullable() }),
);

/** `stats.history` */
export const StatsHistoryOutput = z.object({
  rows: z.array(
    z.object({
      completionPct: z.number(),
      decision: z.string(),
      durationMs: z.number(),
      endedAt: int().nullable(),
      grandparentRatingKey: z.string().nullable(),
      grandparentTitle: z.string().nullable(),
      id: z.string(),
      lastSeenAt: int(),
      local: z.number(),
      platform: z.string(),
      player: z.string(),
      plexSessionKey: z.string(),
      ratingKey: z.string(),
      sectionId: z.string(),
      source: z.string(),
      startedAt: int(),
      state: z.string(),
      title: z.string(),
      type: z.string(),
      userId: int(),
      username: z.string(),
      viewOffsetMs: z.number(),
      watchedMs: z.number(),
    }),
  ),
  total: int(),
});
