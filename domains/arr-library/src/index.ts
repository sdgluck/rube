/* ─── What your *Arrs hold, and how it lines up with Plex ───────────────────
 *
 * This domain owns the mirror: `arr_movies`, `arr_series`, the three small
 * configuration tables that pickers read, and `arr_sync_state`. It answers
 * "what is in my *Arrs" without going near the network.
 *
 * It is a separate domain from `arr-activity` and `arr-settings` on the same
 * rule the config-history header states: a module that owns tables is a
 * different module from one that owns none. `arr-activity` is an append-only
 * event ledger with its own retention and its own consumers; `arr-settings` is
 * the sole writer of remote configuration, which is a guarantee worth a
 * boundary. Folding all three into a `domains/arr` umbrella would repeat the
 * `domains/portability` mistake — a domain named after a noun nobody owns.
 *
 * Reconciliation lives here rather than in a fourth domain. It stores nothing,
 * but it is a read-model over *these* tables, and a read-model belongs with the
 * data it reads.
 */

import { token } from "@tinkerbell/container";
import type { Db } from "@tinkerbell/db";
import { createArrLibrarySync } from "./sync.ts";
import { createArrQueries } from "./queries.ts";
import { createArrReconcile } from "./reconcile.ts";
import { createDiscoverQueries } from "./discover.ts";

export interface ArrLibraryDeps {
  db: Db;
}

export function createArrLibrary(deps: ArrLibraryDeps) {
  return {
    ...createArrLibrarySync(deps),
    ...createArrQueries(deps),
    ...createArrReconcile(deps),
    ...createDiscoverQueries(deps),
  };
}

export type ArrLibrary = ReturnType<typeof createArrLibrary>;

export const ArrLibraryToken = token<ArrLibrary>("arrLibrary");

export type { SyncInstanceResult, SyncProgress } from "./sync.ts";
export type { LibraryQuery, LibraryPage } from "./queries.ts";
export type { ArrIssue } from "./reconcile.ts";
export { discoverKey } from "./discover.ts";
export type { DiscoverKey, ExternalKey, DiscoverHolding, DiscoverArrHolding } from "./discover.ts";
