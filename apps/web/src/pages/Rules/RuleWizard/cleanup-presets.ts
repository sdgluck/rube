import { parseRelativeDate, toRelativeDate } from "@rube/contracts";
import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterOp } from "./types.ts";

/**
 * The handful of questions a cleanup rule is actually asking.
 *
 * The wizard's rule types answer "how should this library be sliced into
 * collections" — one per director, one per decade — which is the wrong
 * question entirely when the outcome is "delete this". Offering all
 * twenty-nine of them on the cleanup path meant the one type that could
 * express "nobody has watched this in a year" was buried among twenty-eight
 * that couldn't express it at all.
 *
 * These are not new rule types. Each one is a `smart_filter` with its clauses
 * already written and a single number left to fill in, so nothing new has to
 * be dispatched at run time and a preset stays a perfectly ordinary rule —
 * "Edit as a full smart filter" in the wizard just stops hiding the tree.
 */

export type PresetKnob = "days" | "percent";

interface ClauseSpec {
  field: string;
  op: SmartFilterOp;
  /** Fixed value, for the clauses the preset doesn't parameterise. */
  value?: string;
}

export interface CleanupPreset {
  value: string;
  label: string;
  description: string;
  /** Clauses in tree order. Exactly one carries the knob (no `value`). */
  clauses: ClauseSpec[];
  knob: PresetKnob;
  knobLabel: string;
  knobDefault: number;
  knobMin: number;
  knobMax: number;
  /** Shown under the knob — the caveat that would otherwise be a support question. */
  note?: string;
}

export const CLEANUP_PRESETS: CleanupPreset[] = [
  {
    value: "stale",
    label: "Not watched in a while",
    description: "Someone watched it once, and nobody has been back to it since.",
    clauses: [{ field: "tb.lastPlayedAt", op: "<" }],
    knob: "days",
    knobLabel: "Not played in the last",
    knobDefault: 365,
    knobMin: 1,
    knobMax: 3650,
    note: "Only matches items with a play on record. Something nobody ever started has no last-played date, so it can never match here — use “Never watched” for those.",
  },
  {
    value: "never_watched",
    label: "Never watched",
    description:
      "No user has ever finished it, and it has been sitting in the library long enough that they had the chance.",
    clauses: [
      { field: "tb.watchedByNobody", op: "=", value: "1" },
      { field: "addedAt", op: "<" },
    ],
    knob: "days",
    knobLabel: "Added more than",
    knobDefault: 180,
    knobMin: 1,
    knobMax: 3650,
    note: "The age check is the point: without it this matches everything imported last night.",
  },
  {
    value: "watched_by_everyone",
    label: "Watched by everyone",
    description: "Every user in the rule's scope has finished it, so it has done its job.",
    clauses: [
      { field: "tb.watchedByAll", op: "=", value: "1" },
      { field: "addedAt", op: "<" },
    ],
    knob: "days",
    knobLabel: "Added more than",
    knobDefault: 90,
    knobMin: 1,
    knobMax: 3650,
  },
  {
    value: "abandoned",
    label: "Started and abandoned",
    description:
      "Somebody pressed play and nobody got far — the clearest signal a library has that an item isn't wanted.",
    clauses: [{ field: "tb.abandonedPct", op: "<" }],
    knob: "percent",
    knobLabel: "Nobody got past",
    knobDefault: 20,
    knobMin: 1,
    knobMax: 99,
    note: "Items nobody ever started are excluded — otherwise this would match the entire unwatched library.",
  },
];

const BY_VALUE = new Map(CLEANUP_PRESETS.map((p) => [p.value, p]));

export function cleanupPreset(value: string | undefined): CleanupPreset | null {
  return value ? (BY_VALUE.get(value) ?? null) : null;
}

/** The knob's value as it is written into the clause. */
function knobValue(preset: CleanupPreset, amount: number): string {
  return preset.knob === "days" ? toRelativeDate(amount, "d") : String(amount);
}

/** Inverse of `knobValue`. Null when the clause holds something else entirely. */
function readKnob(preset: CleanupPreset, value: string): number | null {
  if (preset.knob === "percent") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const relative = parseRelativeDate(value);
  // A preset's date clause is always a rolling offset in days. An exact date,
  // or an offset in weeks, is something the user changed by hand — it is a
  // valid filter, just no longer this preset.
  return relative && relative.unit === "d" ? relative.amount : null;
}

export function buildPresetFilter(preset: CleanupPreset, amount: number): SmartFilterGroup {
  return {
    kind: "group",
    combinator: "all",
    children: preset.clauses.map((c): SmartFilterLeaf => ({
      kind: "leaf",
      field: c.field,
      op: c.op,
      value: c.value ?? knobValue(preset, amount),
    })),
  };
}

/**
 * Which preset — if any — built this tree, and what its knob was set to.
 *
 * Editing an existing rule reaches the wizard as a filter tree with no memory
 * of how it was made, so the preset is recovered by matching the shape. Any
 * edit that moves it away from that shape (a third clause, an OR, a hand-typed
 * date) simply stops matching, and the rule opens in the full editor — which
 * is the honest answer, not a failure.
 */
export function presetFromFilter(tree: SmartFilterGroup): { preset: CleanupPreset; amount: number } | null {
  if (tree.combinator !== "all") return null;
  for (const preset of CLEANUP_PRESETS) {
    if (tree.children.length !== preset.clauses.length) continue;
    let amount: number | null = null;
    const matches = preset.clauses.every((spec, i) => {
      const child = tree.children[i];
      if (!child || child.kind !== "leaf") return false;
      if (child.field !== spec.field || child.op !== spec.op) return false;
      if (spec.value !== undefined) return child.value === spec.value;
      amount = readKnob(preset, child.value);
      return amount !== null;
    });
    if (matches && amount !== null) return { preset, amount };
  }
  return null;
}
