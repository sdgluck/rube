import { createHash } from "node:crypto";

/**
 * Stable hash of a rule config, used to tell "the user has edited this" from
 * "still exactly what we imported".
 *
 * Keys are sorted at every level because `JSON.stringify` preserves insertion
 * order: a config that round-trips through the editor can come back with the
 * same values in a different order, and hashing that naively would report a
 * spurious local edit and suppress a legitimate update prompt.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function hashConfig(config: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(config)))
    .digest("hex")
    .slice(0, 32);
}
