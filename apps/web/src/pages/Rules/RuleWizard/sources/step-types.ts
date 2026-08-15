/**
 * Which rule types show a dedicated Source step.
 *
 * Split from `./index.ts` — which imports the step components themselves —
 * so the wizard's pure step/validation logic can be imported (and unit
 * tested) without dragging React components in behind it. `SOURCE_STEPS` is
 * typed as `Record<SourceStepType, …>`, so a type added here and not wired
 * to a component (or the reverse) is a typecheck error rather than drift.
 */
export const SOURCE_STEP_TYPES = [
  "ai_prompt",
  "imdb_chart",
  "imdb_list",
  "list_source",
  "smart_filter",
  "seerr_requests",
] as const;

export type SourceStepType = (typeof SOURCE_STEP_TYPES)[number];

const TYPES = new Set<string>(SOURCE_STEP_TYPES);

export function hasSourceStep(type: string): boolean {
  return TYPES.has(type);
}
