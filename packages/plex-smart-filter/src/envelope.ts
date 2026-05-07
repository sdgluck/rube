import { parseSmartFilterUri, type SmartFilterGroup } from "./parse.ts";
import { emitSmartFilterTree } from "./emit.ts";

/**
 * Plex stores the smart-collection filter as a full URI:
 *   server://<machineId>/com.plexapp.plugins.library<basePath>?type=…&sort=…&<filter>&includeAdvanced=1
 *
 * The filter parser/emitter only deals with the boolean tree. The
 * envelope captures everything else so we can round-trip without losing
 * shape params. Critically, advanced filters like `show.genre` are
 * silently ignored by Plex unless `includeAdvanced=1` is on the URI, so
 * dropping passthrough shape params on save corrupts the collection
 * (the smart query then resolves to zero items).
 */

/** type/sort are user-editable in the collection detail UI. */
const EDITABLE_SHAPE_KEYS = new Set(["type", "sort"]);

/**
 * Other shape params we know about — preserved verbatim across edits.
 * Keep in sync with `SHAPE_FIELDS` in parse.ts (which strips them from
 * the filter tree); anything stripped there must be re-emitted here.
 */
const PASSTHROUGH_SHAPE_KEYS = new Set(["limit", "includeGuids", "includeCollections", "includeAdvanced", "and"]);

export interface SmartFilterEnvelope {
  machineId: string;
  basePath: string;
  type: string;
  sort: string;
  /** Other shape params preserved verbatim, in original order. */
  extras: Array<[string, string]>;
}

const EMPTY_ENVELOPE: SmartFilterEnvelope = {
  machineId: "",
  basePath: "",
  type: "",
  sort: "",
  extras: [],
};

const EMPTY_FILTER: SmartFilterGroup = { kind: "group", combinator: "all", children: [] };

export function splitSmartFilterContent(content: string): {
  envelope: SmartFilterEnvelope;
  filter: SmartFilterGroup;
} {
  const m = content.match(/^server:\/\/([^/]+)\/com\.plexapp\.plugins\.library(.+)$/);
  if (!m) return { envelope: EMPTY_ENVELOPE, filter: EMPTY_FILTER };

  const [, machineId, rest] = m;
  const qIndex = rest.indexOf("?");
  const basePath = qIndex < 0 ? rest : rest.slice(0, qIndex);
  const query = qIndex < 0 ? "" : rest.slice(qIndex + 1);
  const params = new URLSearchParams(query);
  const type = params.get("type") || "";
  const sort = params.get("sort") || "";
  const extras: Array<[string, string]> = [];
  for (const [k, v] of params) {
    if (EDITABLE_SHAPE_KEYS.has(k)) continue;
    if (PASSTHROUGH_SHAPE_KEYS.has(k)) extras.push([k, v]);
  }
  const { filter } = parseSmartFilterUri(`?${query}`);
  return { envelope: { machineId, basePath, type, sort, extras }, filter };
}

export function restoreSmartFilterContent(envelope: SmartFilterEnvelope, filter: SmartFilterGroup): string {
  const parts: string[] = [];
  if (envelope.type) parts.push(`type=${encodeURIComponent(envelope.type)}`);
  if (envelope.sort) parts.push(`sort=${encodeURIComponent(envelope.sort)}`);
  parts.push(...emitSmartFilterTree(filter));
  for (const [k, v] of envelope.extras) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return `server://${envelope.machineId}/com.plexapp.plugins.library${envelope.basePath}?${parts.join("&")}`;
}
