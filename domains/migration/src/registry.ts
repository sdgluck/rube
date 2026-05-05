import type { ProviderRuntime } from "./runtime.ts";
import { KOMETA_RUNTIME } from "./runtimes/kometa.ts";
import { PLEX_SMART_RUNTIME } from "./runtimes/plex-smart.ts";
import { MDBLIST_RUNTIME } from "./runtimes/mdblist.ts";

const REGISTRY: Record<string, ProviderRuntime> = {
  [KOMETA_RUNTIME.id]: KOMETA_RUNTIME,
  [PLEX_SMART_RUNTIME.id]: PLEX_SMART_RUNTIME,
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
