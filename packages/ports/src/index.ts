/**
 * The inverted edges.
 *
 * This package is the replacement for `packages/core/src/hooks.ts` and the
 * `setHealthReporter` slot in `clients.ts` — the four places where a
 * lower-level module needed to reach a higher-level one and the answer was a
 * module-level `let` defaulting to a no-op. Those defaults are what made the
 * Sidequest worker's missing `registerCoreHooks()` invisible: health reports,
 * notification traces, provider rescans and collection-label reads all did
 * nothing, silently, for every job.
 *
 * Here each of them is an interface with a token. A domain declares what it
 * needs; `@tinkerbell/composition` is the one place that says who provides it;
 * and the resolve-all test fails the build if nobody does.
 *
 * **Scope rule:** this package holds only the edges that have no natural owner
 * — the ones that would be an import cycle if either side owned them. A token
 * for a thing that *does* have an owner lives beside that thing (`DbToken` in
 * `@tinkerbell/db`, `ConfigStoreToken` in `@tinkerbell/core`), because putting
 * it here would mean this package importing half the workspace and the wave-0
 * packages could no longer depend on it.
 *
 * Consequently: no runtime imports, and no dependencies beyond the container.
 */

import { token } from "@tinkerbell/container";

// ─── Health ───────────────────────────────────────────────────────────────────

export type HealthStatus = "ok" | "error";

/**
 * Where a client reports that an upstream answered, or didn't.
 *
 * Provided by `domains/health`, consumed by every client factory in
 * `@tinkerbell/core`. The dependency runs the wrong way round for an import —
 * health sits above core — which is why it was a mutable setter.
 */
export type HealthReporter = (service: string, status: HealthStatus, message: string) => void;

export const HealthReporterToken = token<HealthReporter>("health.reporter");

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * A function rather than an object with an `emit` method, to match
 * `HealthReporter` and because that is the shape every call site already has:
 * `emitEvent(type, message, metadata)`. An object would mean either rewriting
 * ~100 call sites or binding a method off it at every injection point.
 */
export type EventBus = (type: string, message: string, metadata?: Record<string, unknown>) => void;

/**
 * Provided by `domains/events`. `domains/notifications` records suppressed and
 * failed sends through it — and events already imports notifications, so a
 * direct dependency is a genuine cycle rather than a layering preference.
 */
export const EventBusToken = token<EventBus>("events.bus");

/**
 * The outbound half of the events/notifications pair: `domains/events` hands a
 * recorded event to `domains/notifications` for delivery.
 *
 * This is a genuine cycle — notifications also emits events (a failed send is
 * itself something the activity feed should show), which is why the inbound
 * half was `setEventEmitter`. Both directions are ports now, and the
 * composition root registers each as a closure that resolves the other domain
 * when it is *called* rather than when it is built, so neither construction
 * waits on the other.
 */
export type Notifier = (type: string, message: string, metadata?: Record<string, unknown>) => void;

export const NotifierToken = token<Notifier>("notifications.notify");

// ─── Collections ──────────────────────────────────────────────────────────────

/**
 * The subset of a collection that crosses the domain boundary. The full
 * `CollectionRow` stays in `domains/collections`; `domains/users` only ever
 * counts `User:<name>` markers in the labels.
 */
export interface LocalCollection {
  labels: string[];
}

export type CollectionsReader = () => { items: LocalCollection[] };

export const CollectionsReaderToken = token<CollectionsReader>("collections.reader");

/**
 * Run at the end of `syncCollections` so a Plex sync refreshes the Kometa (and
 * other provider) scans. Provided by `domains/migration`, called from
 * `domains/collections`, which sits below it.
 */
export type PostCollectionSync = () => Promise<void> | void;

export const PostCollectionSyncToken = token<PostCollectionSync>("collections.postSync");

// ─── Change history ───────────────────────────────────────────────────────────

/**
 * The kinds of thing whose edits are worth keeping.
 *
 * Deliberately not "every table". These are the five that a person configures
 * and can therefore misconfigure; the rest are either derived (`media_items`,
 * `collections`) or already have a ledger of their own.
 */
export type ChangeEntity = "rule" | "config" | "job" | "overlay_preset" | "preroll";

/**
 * `import` and `restore` are separate from `update` because they answer a
 * different question. "Who changed this?" is usually answered by the source,
 * but "was this whole state pulled in from somewhere else?" is the one asked
 * after a bundle import goes wrong, and it needs to be visible on the row.
 */
export type ChangeAction = "create" | "update" | "delete" | "import" | "restore";

export interface ChangeRecord {
  entity: ChangeEntity;
  /** The rule id, the config key, the job id. */
  entityId: string;
  action: ChangeAction;
  /** The whole prior state. Omitted for a create. */
  before?: unknown;
  /** The whole resulting state. Omitted for a delete. */
  after?: unknown;
  /**
   * Overrides the ambient actor. Set it only where the ambient answer would be
   * wrong — an import attributing every rule it writes to the request that
   * uploaded the bundle, say.
   */
  source?: string;
  username?: string;
}

/**
 * Where an edit to Tinkerbell's own configuration is recorded.
 *
 * Provided by `domains/config-history`, consumed by `@tinkerbell/core`'s config
 * store and by four domains that sit below it. The direction is the same one
 * that made `HealthReporter` a port: the recorder needs the database and a
 * redaction pass, and the things being recorded sit underneath it.
 *
 * There is deliberately no no-op default. A container assembled without a
 * recorder fails to resolve, rather than quietly keeping no history — which is
 * indistinguishable from having no bug for exactly as long as it takes someone
 * to need the history.
 */
export type ChangeRecorder = (change: ChangeRecord) => void;

export const ChangeRecorderToken = token<ChangeRecorder>("history.recorder");

// ─── Jobs ─────────────────────────────────────────────────────────────────────

/**
 * Change a job's schedule, its enabled flag, or its config.
 *
 * Provided by `packages/jobs`, consumed by `domains/portability` when a bundle
 * carries job schedules. The direction is the familiar one: the job runner sits
 * above every domain (its commands resolve `ServicesToken`), so a domain
 * importing it would be a genuine cycle.
 *
 * A port rather than a direct table write because `updateJob` does two things
 * beyond the row — it validates the cron expression, and it rebuilds the live
 * `Cron` object. An import that wrote the column directly would leave the
 * running scheduler on the old schedule until the next restart, which is a bug
 * that only shows up as "the imported schedule didn't take" hours later.
 */
export type JobConfigWriter = (
  jobId: string,
  updates: { schedule?: string; enabled?: boolean; config?: Record<string, unknown> },
) => void;

export const JobConfigWriterToken = token<JobConfigWriter>("jobs.configWriter");
