/* ─── Getting your configuration out, and back in ───────────────────────────
 *
 * Everything Rube knows lives in one SQLite file. That is a good default
 * and a bad boundary: there was no way to get a rule out of the app except by
 * publishing it to the public registry, no way to move to a new host except by
 * copying a binary database and hoping the schema versions lined up, and no way
 * to send somebody a broken rule so they could look at it.
 *
 * This domain is the answer: one JSON document, versioned and self-describing,
 * built here and read back here.
 *
 * It does not own a table. Export reads the same rows every other domain owns,
 * and import writes through those domains' own functions rather than around
 * them — see `ImportWriters` for why that is load-bearing rather than tidy.
 */
import { token } from "@rube/container";

import { createExport, type ExportDeps, type ExportOptions, type ExportResult } from "./export.ts";
import {
  createImport,
  type ImportDecisions,
  type ImportDeps,
  type ImportItem,
  type ImportKind,
  type ImportPreview,
  type ImportSummary,
  type ImportWriters,
} from "./import.ts";

export type {
  ExportOptions,
  ExportResult,
  ImportDecisions,
  ImportItem,
  ImportKind,
  ImportPreview,
  ImportSummary,
  ImportWriters,
};

export type PortabilityDeps = ExportDeps & ImportDeps;

export function createPortability(deps: PortabilityDeps) {
  return { ...createExport(deps), ...createImport(deps) };
}

export type Portability = ReturnType<typeof createPortability>;

export const PortabilityToken = token<Portability>("domain.portability");
