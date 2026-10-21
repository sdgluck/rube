/**
 * Every domain, and the four inverted edges that used to be mutable setters.
 *
 * Registration order is irrelevant — nothing is constructed while this runs —
 * so the list is alphabetical rather than topological. What matters is that
 * each domain names its dependencies in its own `Deps` interface and this file
 * satisfies them; a dependency nobody registers is a resolve-time error, and
 * `container.test.ts` turns that into a build failure.
 */
import type { Registry } from "@rube/container";
import { DbToken } from "@rube/db";
import { ArrInstancesToken, ClientsToken, ConfigStoreToken, SharingToken } from "@rube/core";
import {
  ChangeRecorderToken,
  ClockToken,
  CollectionsReaderToken,
  JobConfigWriterToken,
  EventBusToken,
  HealthReporterToken,
  NotifierToken,
  PostCollectionSyncToken,
} from "@rube/ports";
import { AiUsageToken, createAiUsage } from "@rube/domain.ai-usage";
import { ApiKeysToken, createApiKeys } from "@rube/domain.api-keys";
import { BackupsToken, createBackups } from "@rube/domain.backups";
import { BandwidthToken, createBandwidth } from "@rube/domain.bandwidth";
import { ChangesToken, createChanges } from "@rube/domain.changes";
import { ArrActivityToken, createArrActivity } from "@rube/domain.arr-activity";
import { ArrLibraryToken, createArrLibrary } from "@rube/domain.arr-library";
import { ArrSettingsToken, createArrSettings } from "@rube/domain.arr-settings";
import { ConfigHistoryToken, createConfigHistory } from "@rube/domain.config-history";
import { CleanupToken, createCleanup } from "@rube/domain.cleanup";
import { CollectionsToken, createCollections } from "@rube/domain.collections";
import { createDigest, DigestToken } from "@rube/domain.digest";
import { DownloadClientsToken, createDownloadClients } from "@rube/domain.download-clients";
import { createEvents, EventsToken } from "@rube/domain.events";
import { createHealth, HealthToken } from "@rube/domain.health";
import { createMatch, MatchToken } from "@rube/domain.match";
import { createMedia, MediaToken } from "@rube/domain.media";
import { createMetadata, MetadataToken } from "@rube/domain.metadata";
import { createMetadataOverrides, MetadataOverridesToken } from "@rube/domain.metadata-overrides";
import { createPlaylists, PlaylistsToken } from "@rube/domain.playlists";
import { createPortability, PortabilityToken } from "@rube/domain.portability";
import { createMigration, MigrationToken } from "@rube/domain.migration";
import { createNotifications, NotificationsToken } from "@rube/domain.notifications";
import { createOnboarding, OnboardingToken } from "@rube/domain.onboarding";
import { createOverlays, OverlaysToken } from "@rube/domain.overlays";
import { createPlayback, PlaybackToken } from "@rube/domain.playback";
import { createPrerolls, PrerollsToken } from "@rube/domain.prerolls";
import { createProblems, ProblemsToken } from "@rube/domain.problems";
import { createQualitySwaps, QualitySwapsToken } from "@rube/domain.quality-swaps";
import { createRecommendations, RecommendationsToken } from "@rube/domain.recommendations";
import { createRegistry, RegistryToken } from "@rube/domain.registry";
import { createRuleHistory, RuleHistoryToken } from "@rube/domain.rule-history";
import { createRuleDrafts, RuleDraftsToken } from "@rube/domain.rule-drafts";
import { createRuleRuns, RuleRunsToken } from "@rube/domain.rule-runs";
import { createRules, RulesToken } from "@rube/domain.rules";
import { createSearch, SearchToken } from "@rube/domain.search";
import { createSections, SectionsToken } from "@rube/domain.sections";
import { createStats, StatsToken } from "@rube/domain.stats";
import { createUsers, UsersToken } from "@rube/domain.users";
import { createWatchlist, WatchlistToken } from "@rube/domain.watchlist";

export function registerDomains(r: Registry): void {
  // ── The inverted edges ────────────────────────────────────────────────────
  //
  // Each is a closure that resolves its provider when *called*, not when built.
  // That is what lets the two genuine cycles exist at all: notifications emits
  // events and events notifies, and collections triggers a migration rescan
  // while migration reads collections. Late binding was always how these
  // worked — `setEventEmitter` and friends were assigned at startup — but the
  // binding was a mutable global that defaulted to a no-op, so forgetting it
  // produced silence rather than an error. Here it is declared once, and a
  // missing provider fails to resolve.
  r.register(
    EventBusToken,
    (c) => (type, message, metadata) => c.resolve(EventsToken).emitEvent(type, message, metadata),
  );
  r.register(
    NotifierToken,
    (c) => (type, message, metadata) => c.resolve(NotificationsToken).notifyEvent(type, message, metadata),
  );
  r.register(
    HealthReporterToken,
    (c) => (service, status, message) => c.resolve(HealthToken).reportHealth(service, status, message),
  );
  r.register(CollectionsReaderToken, (c) => () => c.resolve(CollectionsToken).getLocalCollections());
  // Late-bound like the rest: the config store is built long before the domain
  // that records its changes, and the config store is itself a dependency of
  // almost everything, so binding at call time is what keeps this an edge
  // rather than a cycle.
  r.register(ChangeRecorderToken, (c) => (change) => c.resolve(ConfigHistoryToken).record(change));
  r.register(PostCollectionSyncToken, (c) => () => c.resolve(MigrationToken).scanAllProviders());

  // ── Domains ───────────────────────────────────────────────────────────────
  r.register(BackupsToken, (c) =>
    createBackups({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      emitEvent: c.resolve(EventBusToken),
    }),
  );
  r.register(BandwidthToken, (c) =>
    createBandwidth({
      db: c.resolve(DbToken),
      clients: c.resolve(ClientsToken),
      emitEvent: c.resolve(EventBusToken),
    }),
  );
  r.register(ArrLibraryToken, (c) => createArrLibrary({ db: c.resolve(DbToken) }));
  r.register(AiUsageToken, (c) =>
    createAiUsage({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken), now: c.resolve(ClockToken) }),
  );
  r.register(ApiKeysToken, (c) => createApiKeys({ db: c.resolve(DbToken), now: c.resolve(ClockToken) }));
  r.register(ArrActivityToken, (c) => createArrActivity({ db: c.resolve(DbToken) }));
  r.register(ArrSettingsToken, (c) =>
    createArrSettings({
      db: c.resolve(DbToken),
      arr: c.resolve(ArrInstancesToken),
      refreshConfigMirror: (instance, client) => c.resolve(ArrLibraryToken).refreshConfigMirror(instance, client),
      recordChange: c.resolve(ChangeRecorderToken),
      emitEvent: c.resolve(EventBusToken),
      now: c.resolve(ClockToken),
    }),
  );
  r.register(ChangesToken, (c) => createChanges({ db: c.resolve(DbToken) }));
  r.register(ConfigHistoryToken, (c) => createConfigHistory({ db: c.resolve(DbToken) }));
  r.register(CleanupToken, (c) =>
    createCleanup({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken), now: c.resolve(ClockToken) }),
  );
  r.register(CollectionsToken, (c) =>
    createCollections({
      db: c.resolve(DbToken),
      runPostCollectionSync: c.resolve(PostCollectionSyncToken),
    }),
  );
  r.register(DigestToken, (c) =>
    createDigest({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      sharing: c.resolve(SharingToken),
      cleanup: c.resolve(CleanupToken),
    }),
  );
  r.register(DownloadClientsToken, (c) => createDownloadClients({ config: c.resolve(ConfigStoreToken) }));
  r.register(EventsToken, (c) => createEvents({ db: c.resolve(DbToken), notifyEvent: c.resolve(NotifierToken) }));
  r.register(HealthToken, (c) =>
    createHealth({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      emitEvent: c.resolve(EventBusToken),
      arr: c.resolve(ArrInstancesToken),
      prerolls: c.resolve(PrerollsToken),
      aiUsage: c.resolve(AiUsageToken),
    }),
  );
  r.register(MatchToken, (c) =>
    createMatch({ db: c.resolve(DbToken), now: c.resolve(ClockToken), sharing: c.resolve(SharingToken) }),
  );
  r.register(MediaToken, (c) => createMedia({ db: c.resolve(DbToken), emitEvent: c.resolve(EventBusToken) }));
  r.register(MetadataToken, (c) => createMetadata({ db: c.resolve(DbToken), now: c.resolve(ClockToken) }));
  r.register(MetadataOverridesToken, (c) => createMetadataOverrides({ db: c.resolve(DbToken) }));
  r.register(PlaylistsToken, (c) => createPlaylists({ db: c.resolve(DbToken) }));
  r.register(MigrationToken, (c) => createMigration({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken) }));
  r.register(NotificationsToken, (c) =>
    createNotifications({ config: c.resolve(ConfigStoreToken), emitEvent: c.resolve(EventBusToken) }),
  );
  r.register(OnboardingToken, (c) =>
    createOnboarding({
      config: c.resolve(ConfigStoreToken),
      rules: c.resolve(RulesToken),
      migration: c.resolve(MigrationToken),
    }),
  );
  r.register(OverlaysToken, (c) =>
    createOverlays({ db: c.resolve(DbToken), recordChange: c.resolve(ChangeRecorderToken) }),
  );
  r.register(PlaybackToken, (c) =>
    createPlayback({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      clients: c.resolve(ClientsToken),
      bandwidth: c.resolve(BandwidthToken),
    }),
  );
  r.register(PortabilityToken, (c) =>
    createPortability({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      // Plex is asked for tag names only when a rule actually has tag clauses,
      // and a failure degrades to a warning rather than an aborted export —
      // see `portableRuleConfig`. Resolving the client lazily here keeps an
      // unconfigured Plex from breaking the whole domain's construction.
      tagLookup: (sectionId, field) => c.resolve(ClientsToken).getPlexClient().getFilterFieldValues(sectionId, field),
      sections: () => c.resolve(SectionsToken).getLocalSections(),
      writers: {
        createRule: (input, origin) => c.resolve(RulesToken).createRule(input, origin),
        updateRule: (id, updates, origin) => c.resolve(RulesToken).updateRule(id, updates, origin),
        updateJob: (id, updates) => c.resolve(JobConfigWriterToken)(id, updates),
        savePreset: (input) => c.resolve(OverlaysToken).savePreset(input),
        addOverlayConfig: (input) => c.resolve(OverlaysToken).addOverlayConfig(input),
        updateOverlayConfig: (id, patch) => c.resolve(OverlaysToken).updateOverlayConfig(id, patch),
        setConfig: (key, value) => c.resolve(ConfigStoreToken).setConfig(key, value),
        importManagedProfiles: (rows, opts) => c.resolve(ArrSettingsToken).quality.importManaged(rows, opts),
      },
      arrInstanceIds: () =>
        c
          .resolve(ArrInstancesToken)
          .arrInstances()
          .map((i) => i.id),
    }),
  );
  r.register(PrerollsToken, (c) =>
    createPrerolls({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      clients: c.resolve(ClientsToken),
      recordChange: c.resolve(ChangeRecorderToken),
    }),
  );
  r.register(ProblemsToken, (c) =>
    createProblems({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      // Resolved per call, as for portability: an unconfigured Plex must fail
      // the fix or the scan that needs it, not the construction of the page.
      plex: (opts) => c.resolve(ClientsToken).getPlexClient(opts),
      arrInstances: () => c.resolve(ArrInstancesToken).arrInstances(),
      reconcile: c.resolve(ArrLibraryToken),
      ruleConflicts: () => c.resolve(RulesToken).findRuleConflicts(),
      recordChange: c.resolve(ChangeRecorderToken),
      emitEvent: c.resolve(EventBusToken),
      now: c.resolve(ClockToken),
    }),
  );
  r.register(QualitySwapsToken, (c) =>
    createQualitySwaps({
      db: c.resolve(DbToken),
      arr: c.resolve(ArrInstancesToken),
      emitEvent: c.resolve(EventBusToken),
      now: c.resolve(ClockToken),
    }),
  );
  r.register(RecommendationsToken, (c) =>
    createRecommendations({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken) }),
  );
  r.register(RegistryToken, (c) =>
    createRegistry({ config: c.resolve(ConfigStoreToken), rules: c.resolve(RulesToken) }),
  );
  r.register(RuleHistoryToken, (c) => createRuleHistory({ db: c.resolve(DbToken) }));
  r.register(RuleDraftsToken, (c) =>
    createRuleDrafts({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      aiUsage: c.resolve(AiUsageToken),
      // Resolved per call: an unconfigured Plex fails the draft, not the page.
      plex: (opts) => c.resolve(ClientsToken).getPlexClient(opts),
      now: c.resolve(ClockToken),
    }),
  );
  r.register(RuleRunsToken, (c) => createRuleRuns({ db: c.resolve(DbToken), scope: c.owner }));
  r.register(RulesToken, (c) =>
    createRules({
      db: c.resolve(DbToken),
      playback: c.resolve(PlaybackToken),
      recordChange: c.resolve(ChangeRecorderToken),
    }),
  );
  r.register(SearchToken, (c) => createSearch({ db: c.resolve(DbToken) }));
  r.register(SectionsToken, (c) => createSections({ db: c.resolve(DbToken) }));
  r.register(StatsToken, (c) =>
    createStats({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      clients: c.resolve(ClientsToken),
      playback: c.resolve(PlaybackToken),
    }),
  );
  r.register(UsersToken, (c) =>
    createUsers({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      readLocalCollections: c.resolve(CollectionsReaderToken),
    }),
  );
  r.register(WatchlistToken, (c) =>
    createWatchlist({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      clients: c.resolve(ClientsToken),
      arr: c.resolve(ArrInstancesToken),
      emitEvent: c.resolve(EventBusToken),
    }),
  );
}
