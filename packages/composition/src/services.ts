/**
 * Every domain, resolved, as one object.
 *
 * Domains take narrow `Deps` — a rule engine that needs the database and the
 * playback store says exactly that. The *orchestration* layers above them, job
 * commands and tRPC routers, legitimately touch a dozen domains each, and
 * threading a bespoke dependency list through every one of those would be
 * ceremony without information: the honest statement is "this is the
 * application, it can reach the application's parts".
 *
 * So this is the seam where breadth is allowed, and it is deliberately the only
 * one. It is still resolved from the container rather than imported, so a test
 * can hand a command a bag with three domains faked and the rest real.
 */
import { token } from "@tinkerbell/container";
import type { Registry, Scope } from "@tinkerbell/container";
import { DbToken, type Db } from "@tinkerbell/db";
import {
  AdminAuthToken,
  ArrInstancesToken,
  ClientsToken,
  ConfigStoreToken,
  PosterCacheToken,
  PostersToken,
  PreferencesToken,
  SessionsToken,
  SharingToken,
  type AdminAuth,
  type ArrInstances,
  type Clients,
  type ConfigStore,
  type Posters,
  type Preferences,
  type Sessions,
  type Sharing,
} from "@tinkerbell/core";
import type { PosterCache } from "@tinkerbell/posters";

import { AiUsageToken, type AiUsage } from "@tinkerbell/domain.ai-usage";
import { ApiKeysToken, type ApiKeys } from "@tinkerbell/domain.api-keys";
import { BackupsToken, type Backups } from "@tinkerbell/domain.backups";
import { BandwidthToken, type Bandwidth } from "@tinkerbell/domain.bandwidth";
import { ChangesToken, type Changes } from "@tinkerbell/domain.changes";
import { ArrActivityToken, type ArrActivity } from "@tinkerbell/domain.arr-activity";
import { ArrLibraryToken, type ArrLibrary } from "@tinkerbell/domain.arr-library";
import { ArrSettingsToken, type ArrSettings } from "@tinkerbell/domain.arr-settings";
import { ConfigHistoryToken, type ConfigHistory } from "@tinkerbell/domain.config-history";
import { CleanupToken, type Cleanup } from "@tinkerbell/domain.cleanup";
import { CollectionsToken, type Collections } from "@tinkerbell/domain.collections";
import { DigestToken, type Digests } from "@tinkerbell/domain.digest";
import { DownloadClientsToken, type DownloadClients } from "@tinkerbell/domain.download-clients";
import { EventsToken, type Events } from "@tinkerbell/domain.events";
import { HealthToken, type Health } from "@tinkerbell/domain.health";
import { MediaToken, type Media } from "@tinkerbell/domain.media";
import { MetadataToken, type Metadata } from "@tinkerbell/domain.metadata";
import { MetadataOverridesToken, type MetadataOverrides } from "@tinkerbell/domain.metadata-overrides";
import { PlaylistsToken, type Playlists } from "@tinkerbell/domain.playlists";
import { PortabilityToken, type Portability } from "@tinkerbell/domain.portability";
import { MigrationToken, type Migration } from "@tinkerbell/domain.migration";
import { MatchToken, type Match } from "@tinkerbell/domain.match";
import { NotificationsToken, type Notifications } from "@tinkerbell/domain.notifications";
import { OnboardingToken, type Onboarding } from "@tinkerbell/domain.onboarding";
import { OverlaysToken, type Overlays } from "@tinkerbell/domain.overlays";
import { PlaybackToken, type Playback } from "@tinkerbell/domain.playback";
import { PrerollsToken, type Prerolls } from "@tinkerbell/domain.prerolls";
import { ProblemsToken, type Problems } from "@tinkerbell/domain.problems";
import { QualitySwapsToken, type QualitySwaps } from "@tinkerbell/domain.quality-swaps";
import { RecommendationsToken, type Recommendations } from "@tinkerbell/domain.recommendations";
import { RegistryToken, type Registry as RuleRegistry } from "@tinkerbell/domain.registry";
import { RuleHistoryToken, type RuleHistory } from "@tinkerbell/domain.rule-history";
import { RuleRunsToken, type RuleRuns } from "@tinkerbell/domain.rule-runs";
import { RulesToken, type Rules } from "@tinkerbell/domain.rules";
import { SearchToken, type Search } from "@tinkerbell/domain.search";
import { SectionsToken, type Sections } from "@tinkerbell/domain.sections";
import { StatsToken, type Stats } from "@tinkerbell/domain.stats";
import { UsersToken, type Users } from "@tinkerbell/domain.users";
import { WatchlistToken, type Watchlist } from "@tinkerbell/domain.watchlist";

export interface Services {
  /**
   * The scope these services were resolved from.
   *
   * Carried so code that builds a *derived* `JobContext` — a single rule run
   * inside a batch, say — can hand it the scope it belongs to instead of
   * inventing one. Everything else should take what it needs as a dependency
   * rather than reaching through this.
   */
  scope: Scope;
  db: Db;

  config: ConfigStore;
  clients: Clients;
  arr: ArrInstances;
  sharing: Sharing;
  preferences: Preferences;
  posters: Posters;
  postersCache: PosterCache;
  sessions: Sessions;
  adminAuth: AdminAuth;

  backups: Backups;
  bandwidth: Bandwidth;
  changes: Changes;
  arrLibrary: ArrLibrary;
  arrActivity: ArrActivity;
  aiUsage: AiUsage;
  apiKeys: ApiKeys;
  arrSettings: ArrSettings;
  configHistory: ConfigHistory;
  cleanup: Cleanup;
  collections: Collections;
  digest: Digests;
  downloadClients: DownloadClients;
  events: Events;
  health: Health;
  media: Media;
  metadata: Metadata;
  metadataOverrides: MetadataOverrides;
  playlists: Playlists;
  portability: Portability;
  match: Match;
  migration: Migration;
  notifications: Notifications;
  onboarding: Onboarding;
  overlays: Overlays;
  playback: Playback;
  prerolls: Prerolls;
  problems: Problems;
  qualitySwaps: QualitySwaps;
  recommendations: Recommendations;
  registry: RuleRegistry;
  ruleHistory: RuleHistory;
  ruleRuns: RuleRuns;
  rules: Rules;
  search: Search;
  sections: Sections;
  stats: Stats;
  users: Users;
  watchlist: Watchlist;
}

export const ServicesToken = token<Services>("services");

export function registerServices(r: Registry): void {
  r.register(ServicesToken, (c) => ({
    scope: c.owner,
    db: c.resolve(DbToken),

    config: c.resolve(ConfigStoreToken),
    clients: c.resolve(ClientsToken),
    arr: c.resolve(ArrInstancesToken),
    sharing: c.resolve(SharingToken),
    preferences: c.resolve(PreferencesToken),
    posters: c.resolve(PostersToken),
    postersCache: c.resolve(PosterCacheToken),
    sessions: c.resolve(SessionsToken),
    adminAuth: c.resolve(AdminAuthToken),

    backups: c.resolve(BackupsToken),
    bandwidth: c.resolve(BandwidthToken),
    changes: c.resolve(ChangesToken),
    arrLibrary: c.resolve(ArrLibraryToken),
    arrActivity: c.resolve(ArrActivityToken),
    aiUsage: c.resolve(AiUsageToken),
    apiKeys: c.resolve(ApiKeysToken),
    arrSettings: c.resolve(ArrSettingsToken),
    configHistory: c.resolve(ConfigHistoryToken),
    cleanup: c.resolve(CleanupToken),
    collections: c.resolve(CollectionsToken),
    digest: c.resolve(DigestToken),
    downloadClients: c.resolve(DownloadClientsToken),
    events: c.resolve(EventsToken),
    health: c.resolve(HealthToken),
    media: c.resolve(MediaToken),
    metadata: c.resolve(MetadataToken),
    metadataOverrides: c.resolve(MetadataOverridesToken),
    playlists: c.resolve(PlaylistsToken),
    portability: c.resolve(PortabilityToken),
    match: c.resolve(MatchToken),
    migration: c.resolve(MigrationToken),
    notifications: c.resolve(NotificationsToken),
    onboarding: c.resolve(OnboardingToken),
    overlays: c.resolve(OverlaysToken),
    playback: c.resolve(PlaybackToken),
    prerolls: c.resolve(PrerollsToken),
    problems: c.resolve(ProblemsToken),
    qualitySwaps: c.resolve(QualitySwapsToken),
    recommendations: c.resolve(RecommendationsToken),
    registry: c.resolve(RegistryToken),
    ruleHistory: c.resolve(RuleHistoryToken),
    ruleRuns: c.resolve(RuleRunsToken),
    rules: c.resolve(RulesToken),
    search: c.resolve(SearchToken),
    sections: c.resolve(SectionsToken),
    stats: c.resolve(StatsToken),
    users: c.resolve(UsersToken),
    watchlist: c.resolve(WatchlistToken),
  }));
}
