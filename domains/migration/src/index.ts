import { db, collections } from "@tinkerbell/db";
import {
  kometaProvider,
  type BucketKind,
  type CollectionInput,
  type MigrationPlan,
  type PlanItem,
} from "@tinkerbell/migrate";
import { deleteConfig, getConfig, setConfig } from "@tinkerbell/core";

/**
 * Server-side wrapper around a migration source. Each provider owns its
 * own scan + plan logic so the registry is just routing — sources whose
 * data lives in already-synced Plex tables (Kometa) coexist with
 * sources whose data lives in an external API (MDBList, Trakt) without
 * forcing one shape on the other.
 */
export interface ProviderRuntime {
  id: string;
  /** Display label for UI (banner, settings page tab). */
  label: string;
  /**
   * True if this provider should be scanned on every collections sync.
   * Set false for API-backed providers so the cron sync doesn't fan out
   * to external services on every run.
   */
  autoScan: boolean;
  /** Cheap re-scan: re-counts source items. May be sync or async. */
  scan(): Promise<ProviderScanResult> | ProviderScanResult;
  /** Build a fresh migration plan. May be expensive for API providers. */
  buildPlan(): Promise<MigrationPlan> | MigrationPlan;
}

export interface ProviderScanResult {
  count: number;
  scannedAt: number;
  bySection: Array<{ sectionId: string; sectionTitle: string; count: number }>;
}

export interface ProviderStatus {
  id: string;
  label: string;
  count: number;
  scannedAt: number | null;
  bySection: ProviderScanResult["bySection"];
  dismissedAt: number | null;
  completedAt: number | null;
  shouldShowBanner: boolean;
}

export interface MigrationStatus {
  providers: ProviderStatus[];
  /** Sum of `count` across all providers — drives banner copy. */
  totalCount: number;
  /** True iff any provider has unmigrated, undismissed items. */
  shouldShowBanner: boolean;
}

// ─── Kometa runtime ──────────────────────────────────────────────────────

function loadKometaCollectionInputs(): CollectionInput[] {
  const rows = db
    .select({
      ratingKey: collections.plexRatingKey,
      title: collections.title,
      labels: collections.labels,
      sectionId: collections.sectionId,
      sectionTitle: collections.sectionTitle,
    })
    .from(collections)
    .all();

  return rows.map((r) => ({
    ratingKey: r.ratingKey,
    title: r.title,
    labels: Array.isArray(r.labels) ? r.labels : [],
    sectionId: r.sectionId,
    sectionTitle: r.sectionTitle,
  }));
}

const KOMETA_BUCKET_TO_RULE_TYPE: Partial<Record<BucketKind, string>> = {
  studio: "studios",
  network: "networks",
  genre: "genres",
  country: "countries",
  actor: "actors",
  director: "directors",
  content_rating: "content_ratings",
  franchise: "tmdb_franchises",
  decade: "decades",
  year: "years",
  resolution: "resolutions",
  audio_language: "audio_languages",
  subtitle_language: "subtitle_languages",
  video_format: "video_formats",
  streaming: "streaming",
  based_on: "based_on",
  seasonal: "seasonal",
  award: "awards",
};

const KOMETA_RUNTIME: ProviderRuntime = {
  id: "kometa",
  label: "Kometa",
  // Sourced from already-synced Plex collections — cheap to recount on
  // every collections sync.
  autoScan: true,
  scan(): ProviderScanResult {
    const detected = kometaProvider.detect(loadKometaCollectionInputs());
    return summariseBySection(detected);
  },
  buildPlan(): MigrationPlan {
    const all = loadKometaCollectionInputs();
    const detected = kometaProvider.detect(all);
    const classified = kometaProvider.classify(detected);
    return kometaProvider.buildPlan(classified, { supportedRuleTypes: KOMETA_BUCKET_TO_RULE_TYPE });
  },
};

// ─── MDBList runtime ─────────────────────────────────────────────────────

interface MdbListUserList {
  id: number;
  name: string;
  /** Owner's username — together with `name` forms the slug fallback. */
  user_name?: string;
  /** Item count if the API returned one; we don't fetch list contents here. */
  items?: number;
  mediatype?: string;
}

async function fetchMdbUserLists(): Promise<MdbListUserList[]> {
  const apiKey = getConfig("global_mdblist_api_key");
  if (!apiKey) return [];
  const url = `https://api.mdblist.com/lists/user?apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`MDBList ${res.status} ${res.statusText}`);
  const data = (await res.json()) as MdbListUserList[] | { error: string };
  if (!Array.isArray(data)) throw new Error(`MDBList: ${data.error ?? "unexpected response"}`);
  return data;
}

const MDBLIST_RUNTIME: ProviderRuntime = {
  id: "mdblist",
  label: "MDBList",
  // Hits the MDBList API — only run on demand from the Settings → Migrate
  // tab, never from the cron sync hook.
  autoScan: false,
  async scan(): Promise<ProviderScanResult> {
    const lists = await fetchMdbUserLists();
    return { count: lists.length, scannedAt: Date.now(), bySection: [] };
  },
  async buildPlan(): Promise<MigrationPlan> {
    const lists = await fetchMdbUserLists();
    const proposed: PlanItem[] = lists.map((list) => ({
      key: `mdblist::${list.id}`,
      bucket: "list" as const,
      ruleType: "list_source",
      ruleName: list.name,
      // External lists aren't tied to a Plex section; the user picks which
      // sections the rule runs against on the Rules page after migration.
      sectionId: "*",
      sectionTitle: "All sections",
      ruleConfig: {
        listProvider: "mdblist",
        listId: list.user_name ? `${list.user_name}/${list.name}` : String(list.id),
      },
      sampleNames: [list.name],
      replacesCount: 0,
      replacesRatingKeys: [],
    }));
    return { proposed, future: [], unmappable: [], totalKometaCollections: lists.length };
  },
};

// ─── Registry ────────────────────────────────────────────────────────────

const REGISTRY: Record<string, ProviderRuntime> = {
  [KOMETA_RUNTIME.id]: KOMETA_RUNTIME,
  [MDBLIST_RUNTIME.id]: MDBLIST_RUNTIME,
};

export function listProviders(): ProviderRuntime[] {
  return Object.values(REGISTRY);
}

export function getProvider(id: string): ProviderRuntime {
  const runtime = REGISTRY[id];
  if (!runtime) throw new Error(`Unknown migration provider: ${id}`);
  return runtime;
}

// ─── Shared helpers ──────────────────────────────────────────────────────

function summariseBySection(items: CollectionInput[]): ProviderScanResult {
  const sectionMap = new Map<string, { sectionId: string; sectionTitle: string; count: number }>();
  for (const c of items) {
    const existing = sectionMap.get(c.sectionId);
    if (existing) existing.count++;
    else sectionMap.set(c.sectionId, { sectionId: c.sectionId, sectionTitle: c.sectionTitle, count: 1 });
  }
  const bySection = [...sectionMap.values()].sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));
  return { count: items.length, scannedAt: Date.now(), bySection };
}

/**
 * Fold pre-multi-provider config slots (`migration_kometa_*`) into the new
 * `migration_*` provider-keyed slots on first call. Idempotent — old keys
 * are deleted once read so subsequent calls are no-ops.
 */
function migrateLegacyKometaConfig(): void {
  const legacyState = getConfig("migration_kometa_state");
  if (legacyState) {
    const current = getConfig("migration_state") ?? {};
    if (!current.kometa) {
      setConfig("migration_state", { ...current, kometa: legacyState });
    }
    deleteConfig("migration_kometa_state");
  }

  const legacyDismissed = getConfig("migration_kometa_dismissed_at");
  if (legacyDismissed != null) {
    const current = getConfig("migration_dismissed_at") ?? {};
    if (current.kometa == null) {
      setConfig("migration_dismissed_at", { ...current, kometa: legacyDismissed });
    }
    deleteConfig("migration_kometa_dismissed_at");
  }

  const legacyCompleted = getConfig("migration_kometa_completed_at");
  if (legacyCompleted != null) {
    const current = getConfig("migration_completed_at") ?? {};
    if (current.kometa == null) {
      setConfig("migration_completed_at", { ...current, kometa: legacyCompleted });
    }
    deleteConfig("migration_kometa_completed_at");
  }

  const legacyPending = getConfig("migration_kometa_pending_plan");
  if (legacyPending) {
    if (!getConfig("migration_pending_plan")) {
      setConfig("migration_pending_plan", { providerId: "kometa", ...legacyPending });
    }
    deleteConfig("migration_kometa_pending_plan");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Re-scan source data for the given provider and persist the summary in
 * config. Async because some providers (MDBList, Trakt) hit external APIs.
 */
export async function scanProviderState(providerId: string): Promise<ProviderScanResult> {
  migrateLegacyKometaConfig();
  const runtime = getProvider(providerId);
  const result = await runtime.scan();
  const all = getConfig("migration_state") ?? {};
  setConfig("migration_state", { ...all, [providerId]: result });
  return result;
}

/**
 * Re-scan every registered provider that opts into auto-scanning. Called
 * from sync hooks. Providers whose `scan()` hits external APIs (MDBList,
 * Trakt) opt out and are only refreshed from explicit Settings actions.
 */
export async function scanAllProviders(): Promise<void> {
  for (const runtime of listProviders()) {
    if (!runtime.autoScan) continue;
    try {
      await scanProviderState(runtime.id);
    } catch (err) {
      console.warn(`[migration] Failed to scan provider ${runtime.id}:`, err);
    }
  }
}

function buildProviderStatus(runtime: ProviderRuntime): ProviderStatus {
  const state = getConfig("migration_state")?.[runtime.id];
  const dismissedAt = getConfig("migration_dismissed_at")?.[runtime.id] ?? null;
  const completedAt = getConfig("migration_completed_at")?.[runtime.id] ?? null;
  const count = state?.count ?? 0;
  const scannedAt = state?.scannedAt ?? null;
  const bySection = state?.bySection ?? [];
  const shouldShowBanner = count > 0 && completedAt == null && (scannedAt == null || (dismissedAt ?? 0) < scannedAt);
  return {
    id: runtime.id,
    label: runtime.label,
    count,
    scannedAt,
    bySection,
    dismissedAt,
    completedAt,
    shouldShowBanner,
  };
}

export function getProviderStatus(providerId: string): ProviderStatus {
  migrateLegacyKometaConfig();
  return buildProviderStatus(getProvider(providerId));
}

export function getMigrationStatus(): MigrationStatus {
  migrateLegacyKometaConfig();
  const providers = listProviders().map(buildProviderStatus);
  const totalCount = providers.reduce((sum, p) => sum + p.count, 0);
  const shouldShowBanner = providers.some((p) => p.shouldShowBanner);
  return { providers, totalCount, shouldShowBanner };
}

export function dismissProvider(providerId: string): void {
  // Validate so callers can't silently write garbage provider ids.
  getProvider(providerId);
  const all = getConfig("migration_dismissed_at") ?? {};
  setConfig("migration_dismissed_at", { ...all, [providerId]: Date.now() });
}

export function markProviderCompleted(providerId: string): void {
  getProvider(providerId);
  const all = getConfig("migration_completed_at") ?? {};
  setConfig("migration_completed_at", { ...all, [providerId]: Date.now() });
}

export async function buildProviderPlan(providerId: string): Promise<MigrationPlan> {
  return getProvider(providerId).buildPlan();
}
