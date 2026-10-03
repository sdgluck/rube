/**
 * Every domain, and the four inverted edges that used to be mutable setters.
 *
 * Registration order is irrelevant — nothing is constructed while this runs —
 * so the list is alphabetical rather than topological. What matters is that
 * each domain names its dependencies in its own `Deps` interface and this file
 * satisfies them; a dependency nobody registers is a resolve-time error, and
 * `container.test.ts` turns that into a build failure.
 */
import type { Registry } from "@tinkerbell/container";
import { DbToken } from "@tinkerbell/db";
import { ArrInstancesToken, ClientsToken, ConfigStoreToken, SharingToken } from "@tinkerbell/core";
import {
  ChangeRecorderToken,
  ClockToken,
  CollectionsReaderToken,
  JobConfigWriterToken,
  EventBusToken,
  HealthReporterToken,
  NotifierToken,
  PostCollectionSyncToken,
} from "@tinkerbell/ports";
import { BackupsToken, createBackups } from "@tinkerbell/domain.backups";
import { BandwidthToken, createBandwidth } from "@tinkerbell/domain.bandwidth";
import { ChangesToken, createChanges } from "@tinkerbell/domain.changes";
import { ArrActivityToken, createArrActivity } from "@tinkerbell/domain.arr-activity";
import { ArrLibraryToken, createArrLibrary } from "@tinkerbell/domain.arr-library";
import { ArrSettingsToken, createArrSettings } from "@tinkerbell/domain.arr-settings";
import { ConfigHistoryToken, createConfigHistory } from "@tinkerbell/domain.config-history";
import { CleanupToken, createCleanup } from "@tinkerbell/domain.cleanup";
import { CollectionsToken, createCollections } from "@tinkerbell/domain.collections";
import { createDigest, DigestToken } from "@tinkerbell/domain.digest";
import { createEvents, EventsToken } from "@tinkerbell/domain.events";
import { createHealth, HealthToken } from "@tinkerbell/domain.health";
import { createMedia, MediaToken } from "@tinkerbell/domain.media";
import { createMetadata, MetadataToken } from "@tinkerbell/domain.metadata";
import { createMetadataOverrides, MetadataOverridesToken } from "@tinkerbell/domain.metadata-overrides";
import { createPlaylists, PlaylistsToken } from "@tinkerbell/domain.playlists";
import { createPortability, PortabilityToken } from "@tinkerbell/domain.portability";
import { createMigration, MigrationToken } from "@tinkerbell/domain.migration";
import { createNotifications, NotificationsToken } from "@tinkerbell/domain.notifications";
import { createOnboarding, OnboardingToken } from "@tinkerbell/domain.onboarding";
import { createOverlays, OverlaysToken } from "@tinkerbell/domain.overlays";
import { createPlayback, PlaybackToken } from "@tinkerbell/domain.playback";
import { createPrerolls, PrerollsToken } from "@tinkerbell/domain.prerolls";
import { createRegistry, RegistryToken } from "@tinkerbell/domain.registry";
import { createRuleHistory, RuleHistoryToken } from "@tinkerbell/domain.rule-history";
import { createRuleRuns, RuleRunsToken } from "@tinkerbell/domain.rule-runs";
import { createRules, RulesToken } from "@tinkerbell/domain.rules";
import { createSearch, SearchToken } from "@tinkerbell/domain.search";
import { createSections, SectionsToken } from "@tinkerbell/domain.sections";
import { createStats, StatsToken } from "@tinkerbell/domain.stats";
import { createUsers, UsersToken } from "@tinkerbell/domain.users";
import { createWatchlist, WatchlistToken } from "@tinkerbell/domain.watchlist";

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
  r.register(CleanupToken, (c) => createCleanup({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken) }));
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
  r.register(EventsToken, (c) => createEvents({ db: c.resolve(DbToken), notifyEvent: c.resolve(NotifierToken) }));
  r.register(HealthToken, (c) =>
    createHealth({
      db: c.resolve(DbToken),
      config: c.resolve(ConfigStoreToken),
      emitEvent: c.resolve(EventBusToken),
      arr: c.resolve(ArrInstancesToken),
      prerolls: c.resolve(PrerollsToken),
    }),
  );
  r.register(MediaToken, (c) => createMedia({ db: c.resolve(DbToken), emitEvent: c.resolve(EventBusToken) }));
  r.register(MetadataToken, (c) => createMetadata({ db: c.resolve(DbToken) }));
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
  r.register(RegistryToken, (c) =>
    createRegistry({ config: c.resolve(ConfigStoreToken), rules: c.resolve(RulesToken) }),
  );
  r.register(RuleHistoryToken, (c) => createRuleHistory({ db: c.resolve(DbToken) }));
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
