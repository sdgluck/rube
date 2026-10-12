import { PROBLEM_KINDS, PROBLEM_META, type ProblemKind, type ProblemSeverity } from "@tinkerbell/contracts";

/**
 * The Problems pages' arithmetic, kept out of the components so it can be
 * tested without a DOM.
 *
 * The page used to render every kind's full table one after another, which
 * worked for a handful and fell apart at a few hundred: one advisory kind
 * pushed every fault below it off the screen. Now the overview shows one row
 * per kind (`summariseKinds`) and a kind is opened on its own page, searched
 * and paged (`filterKindRows`).
 */

/** The fields these helpers read — structural, so tests needn't build a whole tRPC row. */
export interface ProblemLike {
  kind: ProblemKind;
  subject: string;
  title: string;
  detail: string;
  dismissed: boolean;
  fixable: boolean;
  fixPending?: boolean;
}

export type ShowFilter = "open" | "dismissed" | "all";
export const SHOW_FILTERS: readonly ShowFilter[] = ["open", "dismissed", "all"];

export interface KindSummary {
  kind: ProblemKind;
  severity: ProblemSeverity;
  open: number;
  dismissed: number;
  /** Open, fixable and not already awaiting a scan — what "Fix all" would touch. */
  fixableOpen: number;
}

/** A row a bulk or single Fix may act on. */
export function isFixableOpen(p: ProblemLike): boolean {
  return p.fixable && !p.dismissed && !p.fixPending;
}

/**
 * One entry per kind that has any rows, dismissed ones included — a kind that
 * is all dismissed still needs a way in, or its dismissals can't be undone.
 * Faults first, then advisories, each in the contract's order.
 */
export function summariseKinds(problems: readonly ProblemLike[]): KindSummary[] {
  const byKind = new Map<ProblemKind, KindSummary>();
  for (const p of problems) {
    const s = byKind.get(p.kind) ?? {
      kind: p.kind,
      severity: PROBLEM_META[p.kind].severity,
      open: 0,
      dismissed: 0,
      fixableOpen: 0,
    };
    if (p.dismissed) s.dismissed++;
    else s.open++;
    if (isFixableOpen(p)) s.fixableOpen++;
    byKind.set(p.kind, s);
  }
  return [...PROBLEM_KINDS]
    .sort((a, b) => Number(PROBLEM_META[a].severity === "advisory") - Number(PROBLEM_META[b].severity === "advisory"))
    .flatMap((k) => byKind.get(k) ?? []);
}

/** One kind's rows, narrowed by the dismissed filter and a case-insensitive search of title and detail. */
export function filterKindRows<T extends ProblemLike>(
  problems: readonly T[],
  kind: ProblemKind,
  { q, show }: { q: string; show: ShowFilter },
): T[] {
  const needle = q.trim().toLowerCase();
  return problems.filter(
    (p) =>
      p.kind === kind &&
      (show === "all" || p.dismissed === (show === "dismissed")) &&
      (!needle || p.title.toLowerCase().includes(needle) || p.detail.toLowerCase().includes(needle)),
  );
}
