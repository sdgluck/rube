/**
 * The provider runtimes, keyed by id.
 *
 * Was a module-level `REGISTRY` const built from three imported singletons.
 * Two of those runtimes read the database and one reads config, so they are
 * factories now, and the registry is built per container rather than at import.
 */
import type { Db } from "@tinkerbell/db";
import type { ConfigStore } from "@tinkerbell/core";
import type { ProviderRuntime } from "./runtime.ts";
import { createKometa } from "./runtimes/kometa.ts";
import { createPlexSmart } from "./runtimes/plex-smart.ts";
import { createMdblist } from "./runtimes/mdblist.ts";

export interface ProviderRegistryDeps {
  db: Db;
  config: ConfigStore;
}

export function createProviderRegistry(deps: ProviderRegistryDeps) {
  const runtimes: ProviderRuntime[] = [];
  runtimes.push(
    createKometa(deps).KOMETA_RUNTIME,
    // Reads the others to tell a smart collection it did not create from one it
    // did. Lazily, because this call is what builds them.
    createPlexSmart({ ...deps, otherProviders: () => runtimes }).PLEX_SMART_RUNTIME,
    createMdblist(deps).MDBLIST_RUNTIME,
  );
  const registry: Record<string, ProviderRuntime> = Object.fromEntries(runtimes.map((r) => [r.id, r]));

  function listProviders(): ProviderRuntime[] {
    return Object.values(registry);
  }

  function getProvider(id: string): ProviderRuntime {
    const runtime = registry[id];
    if (!runtime) throw new Error(`Unknown migration provider: ${id}`);
    return runtime;
  }

  return { listProviders, getProvider };
}
