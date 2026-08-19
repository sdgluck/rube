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
import { createKometaYaml } from "./runtimes/kometa-yaml.ts";
import { createPlexSmart } from "./runtimes/plex-smart.ts";
import { createMdblist } from "./runtimes/mdblist.ts";

export interface ProviderRegistryDeps {
  db: Db;
  config: ConfigStore;
}

export function createProviderRegistry(deps: ProviderRegistryDeps) {
  const runtimes: ProviderRuntime[] = [];

  // Built out here as well as registered, because the router needs its
  // ingest-side helpers (save a bundle, read a server path, set the section
  // map) and those have no home on the `ProviderRuntime` interface — that
  // interface describes scanning and planning, which is all the other three
  // providers do.
  const kometaYaml = createKometaYaml(deps);

  runtimes.push(
    // Ahead of the title-scan provider: when a user has their config, that is
    // the path we want them on, and the Migrate page defaults to the first
    // provider with something to say.
    kometaYaml.KOMETA_YAML_RUNTIME,
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

  return { listProviders, getProvider, kometaYaml };
}
