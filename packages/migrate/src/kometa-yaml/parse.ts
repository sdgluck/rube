import { parseDocument, type Document, type Node } from "yaml";
import type { PlanDiagnostic } from "../types.ts";

/**
 * YAML parsing, with the failure behaviour this importer needs.
 *
 * Three things drive the choices here, all of them consequences of the files
 * being hand-written by someone else:
 *
 *  - **Never throw.** A user drags in a `config/` directory and one file has a
 *    tab where a space belongs. Sinking the whole import over it would be a
 *    worse outcome than reporting that one file and mapping the other
 *    nineteen, so a parse failure becomes a diagnostic and an empty result.
 *  - **Keep line numbers.** The review screen's claim to legibility is that it
 *    can say `collections.yml:42` next to a definition. That requires the
 *    document tree, not the plain JS value, so `parseDocument` is used and the
 *    node ranges are carried alongside.
 *  - **Refuse custom tags.** Kometa configs are PyYAML-authored and the format
 *    permits tags that instantiate types. We only ever want data.
 */

/** Byte offsets → 1-based line numbers, computed once per document. */
function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  // Binary search for the last line start at or before `offset`.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export interface ParsedFile {
  path: string;
  /** The plain JS value, or null if the file didn't parse. */
  value: unknown;
  doc: Document | null;
  diagnostics: PlanDiagnostic[];
  /** Resolves a key path (e.g. ["collections", "Top 250"]) to a line number. */
  lineOf(path: Array<string | number>): number | undefined;
}

export function parseYamlFile(path: string, text: string): ParsedFile {
  const diagnostics: PlanDiagnostic[] = [];
  const starts = lineIndex(text);

  let doc: Document | null = null;
  try {
    doc = parseDocument(text, {
      // Data only. A Kometa config has no legitimate reason to carry a tag
      // that constructs anything, and honouring one would mean executing a
      // decision made in a file we did not write.
      customTags: [],
      // Kometa configs use merge keys (`<<: *base`) freely — templates are
      // half the format — so this is not optional.
      merge: true,
      // Silently taking the last of two identical keys is how a hand-edited
      // config loses a collection without anyone noticing.
      uniqueKeys: false,
      strict: false,
    });
  } catch (err) {
    // parseDocument shouldn't throw for malformed input — it collects errors —
    // but a pathological document can still take it down, and losing the whole
    // import to one file is exactly what this module exists to prevent.
    return {
      path,
      value: null,
      doc: null,
      diagnostics: [{ severity: "error", file: path, message: `Could not read YAML: ${(err as Error).message}` }],
      lineOf: () => undefined,
    };
  }

  for (const err of doc.errors) {
    diagnostics.push({
      severity: "error",
      file: path,
      line: err.linePos?.[0]?.line ?? (err.pos?.[0] != null ? lineAt(starts, err.pos[0]) : undefined),
      message: err.message,
    });
  }
  for (const warn of doc.warnings) {
    diagnostics.push({
      severity: "warn",
      file: path,
      line: warn.linePos?.[0]?.line ?? (warn.pos?.[0] != null ? lineAt(starts, warn.pos[0]) : undefined),
      message: warn.message,
    });
  }

  // `doc.errors` non-empty means the tree is untrustworthy even when a value
  // comes back, so treat it as unreadable rather than mapping half a file.
  const value = doc.errors.length > 0 ? null : doc.toJS({ maxAliasCount: 200 });

  function lineOf(keyPath: Array<string | number>): number | undefined {
    if (!doc || keyPath.length === 0) return undefined;
    const node = doc.getIn(keyPath, true) as Node | undefined;
    const start = node?.range?.[0];
    return start == null ? undefined : lineAt(starts, start);
  }

  return { path, value, doc, diagnostics, lineOf };
}

/** Narrow an unknown parsed value to a plain object, or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Kometa accepts a scalar wherever it accepts a list, and means "a list of
 * one". Normalising at every read site would be noise, so it happens here.
 */
export function asList(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Kometa's list-valued strings are comma-separated: `include: a, b, c`. */
export function asStringList(value: unknown): string[] {
  return asList(value)
    .flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
}
