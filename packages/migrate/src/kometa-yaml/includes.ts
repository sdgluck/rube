import type { FileLoader, ImportFile, KometaFileRef, RefResolution } from "./types.ts";
import type { PlanDiagnostic } from "../types.ts";

/**
 * Turn a config's file references into text, or into an explanation.
 *
 * The only rule that matters: a reference that can't be satisfied is a
 * diagnostic, never an exception. Kometa configs routinely point at things a
 * migration can't reach — a URL behind the user's VPN, a folder they didn't
 * include in the upload, a `repo:` against a custom repository. Every one of
 * those is a fixable situation the Resolve step can show and the user can act
 * on, and none of them is a reason to refuse to migrate the files we *do*
 * have.
 */

/** The reason text shown in the file checklist when a ref can't be loaded. */
export const MISSING_REASONS = {
  notInBundle: "Not in the files you provided",
  remoteDisabled: "Remote files aren't fetched during import",
  empty: "Resolved, but contained nothing",
} as const;

export async function resolveRefs(
  refs: KometaFileRef[],
  load: FileLoader,
): Promise<{
  resolutions: RefResolution[];
  diagnostics: PlanDiagnostic[];
}> {
  const resolutions: RefResolution[] = [];
  const diagnostics: PlanDiagnostic[] = [];

  for (const ref of refs) {
    // Deliberately not de-duplicated: the same file referenced from two
    // libraries has to be read twice, because each read produces definitions
    // targeting a different Plex section.
    if (ref.kind === "default") {
      resolutions.push({ status: "default", ref });
      continue;
    }

    let files: ImportFile[] | null = null;
    try {
      files = await load(ref);
    } catch (err) {
      resolutions.push({ status: "missing", ref, reason: (err as Error).message });
      diagnostics.push({
        severity: "warn",
        file: ref.value,
        line: ref.line,
        message: `Couldn't read ${ref.kind}: ${ref.value} — ${(err as Error).message}`,
      });
      continue;
    }

    if (files == null) {
      const reason =
        ref.kind === "url" || ref.kind === "git" || ref.kind === "repo"
          ? MISSING_REASONS.remoteDisabled
          : MISSING_REASONS.notInBundle;
      resolutions.push({ status: "missing", ref, reason });
      diagnostics.push({
        severity: "warn",
        file: ref.value,
        line: ref.line,
        message: `${ref.kind}: ${ref.value} — ${reason}. Collections defined in it weren't migrated.`,
      });
      continue;
    }

    if (files.length === 0) {
      resolutions.push({ status: "missing", ref, reason: MISSING_REASONS.empty });
      continue;
    }

    resolutions.push({ status: "resolved", ref, files });
  }

  return { resolutions, diagnostics };
}

/**
 * A `FileLoader` backed purely by the uploaded bundle.
 *
 * Path matching is deliberately forgiving. Kometa's `file:` paths are written
 * relative to wherever Kometa itself runs (`config/collections/movies.yml`),
 * while a browser directory picker reports paths relative to the folder the
 * user picked (`collections/movies.yml`, or just the folder name plus the
 * rest). Insisting on an exact match would fail almost every real import, so
 * this tries exact, then suffix, then basename — narrowing to broadest, so a
 * precise match always wins over a lucky one.
 */
export function bundleLoader(files: ImportFile[]): FileLoader {
  const byPath = new Map(files.map((f) => [normalise(f.path), f]));

  return async (ref) => {
    if (ref.kind === "file") {
      const want = normalise(ref.value);
      const exact = byPath.get(want);
      if (exact) return [exact];

      const suffix = files.filter((f) => normalise(f.path).endsWith(`/${want}`));
      if (suffix.length === 1) return suffix;

      const base = basename(want);
      const byBase = files.filter((f) => basename(normalise(f.path)) === base);
      // Two files with the same basename and no better signal is ambiguous;
      // guessing would silently migrate the wrong collections.
      return byBase.length === 1 ? byBase : null;
    }

    if (ref.kind === "folder") {
      const want = normalise(ref.value).replace(/\/$/, "");
      const base = basename(want);
      const inFolder = files.filter((f) => {
        const p = normalise(f.path);
        if (!isYaml(p)) return false;
        return p.startsWith(`${want}/`) || p.includes(`/${base}/`);
      });
      return inFolder.length > 0 ? inFolder : null;
    }

    // Remote kinds aren't fetched in this version. Returning null puts them in
    // the Resolve step's checklist with a "paste this file" affordance, which
    // is a better answer than a half-working fetch.
    return null;
  };
}

function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function isYaml(path: string): boolean {
  return /\.ya?ml$/i.test(path);
}
