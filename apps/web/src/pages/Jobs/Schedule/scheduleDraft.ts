/**
 * The schedule page's draft: what the timeline shows, what Undo walks back,
 * and what Save sends.
 *
 * A reducer rather than a pile of `useState` because three things have to stay
 * in step that each looked simple alone. A drag updates the picture on every
 * pointer move but is *one* undo step; applying a preset moves a dozen jobs and
 * is also one step; and when a save is refused because somebody else changed
 * the schedule, the user's edits have to be laid back over the new server state
 * rather than thrown away or blindly re-sent.
 */
import {
  diffSchedulePlans,
  diffScheduleSettings,
  sameSchedule,
  type JobPlanEntry,
  type SchedulePlan,
  type ScheduleSettings,
} from "@tinkerbell/contracts";

const HISTORY_LIMIT = 100;

export interface DraftState {
  /** The server's state when editing began — what Save is checked against. */
  base: SchedulePlan;
  current: SchedulePlan;
  past: SchedulePlan[];
  future: SchedulePlan[];
  /** In-flight drag: drawn, not yet a history step. */
  preview: SchedulePlan | null;
  /** Recorded with the save so History says "Applied Light / low-power". */
  summary: string | null;
}

export type DraftAction =
  | { type: "load"; plan: SchedulePlan }
  | { type: "set-job"; jobId: string; patch: Partial<JobPlanEntry>; preview?: boolean }
  | { type: "commit-preview" }
  | { type: "cancel-preview" }
  | { type: "set-settings"; patch: Partial<ScheduleSettings> }
  | { type: "apply"; plan: SchedulePlan; summary?: string }
  | { type: "revert-job"; jobId: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "discard" }
  | { type: "rebase"; server: SchedulePlan }
  | { type: "saved" };

export function initialDraft(plan: SchedulePlan): DraftState {
  return { base: plan, current: plan, past: [], future: [], preview: null, summary: null };
}

function withJob(plan: SchedulePlan, jobId: string, patch: Partial<JobPlanEntry>): SchedulePlan {
  const entry = plan.jobs[jobId];
  if (!entry) return plan;
  return { ...plan, jobs: { ...plan.jobs, [jobId]: { ...entry, ...patch } } };
}

function push(state: DraftState, next: SchedulePlan, summary = state.summary): DraftState {
  if (next === state.current) return { ...state, preview: null };
  return {
    ...state,
    current: next,
    past: [...state.past, state.current].slice(-HISTORY_LIMIT),
    future: [],
    preview: null,
    summary,
  };
}

function sameEntry(a: JobPlanEntry | undefined, b: JobPlanEntry | undefined): boolean {
  if (!a || !b) return a === b;
  return a.enabled === b.enabled && sameSchedule(a.schedule, b.schedule);
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "load":
      return initialDraft(action.plan);
    case "set-job": {
      if (action.preview) {
        return { ...state, preview: withJob(state.preview ?? state.current, action.jobId, action.patch) };
      }
      return push(state, withJob(state.current, action.jobId, action.patch));
    }
    case "commit-preview":
      return state.preview ? push(state, state.preview) : state;
    case "cancel-preview":
      return { ...state, preview: null };
    case "set-settings":
      return push(state, { ...state.current, settings: { ...state.current.settings, ...action.patch } });
    case "apply":
      return push(state, action.plan, action.summary ?? state.summary);
    case "revert-job": {
      const original = state.base.jobs[action.jobId];
      return original ? push(state, withJob(state.current, action.jobId, original)) : state;
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        current: previous,
        past: state.past.slice(0, -1),
        future: [state.current, ...state.future],
        preview: null,
      };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, current: next, past: [...state.past, state.current], future: rest, preview: null };
    }
    case "discard":
      return initialDraft(state.base);
    case "saved":
      return initialDraft(state.current);
    case "rebase": {
      // Keep what the user changed; take the server's value for everything else.
      const { server } = action;
      const jobs: Record<string, JobPlanEntry> = {};
      for (const [id, entry] of Object.entries(server.jobs)) {
        const mine = state.current.jobs[id];
        jobs[id] = mine && !sameEntry(mine, state.base.jobs[id]) ? mine : entry;
      }
      const settings = { ...server.settings };
      for (const key of diffScheduleSettings(state.base, state.current)) {
        (settings as Record<string, unknown>)[key] = state.current.settings[key];
      }
      return {
        base: server,
        current: { jobs, settings },
        past: [],
        future: [],
        preview: null,
        summary: state.summary,
      };
    }
  }
}

export function isDirty(state: DraftState): boolean {
  return (
    diffSchedulePlans(state.base, state.current).length > 0 ||
    diffScheduleSettings(state.base, state.current).length > 0
  );
}

/** What the server's `jobs.updateSchedules` takes, with `expected` from the base. */
export function toMutation(state: DraftState) {
  const jobs = diffSchedulePlans(state.base, state.current).map(({ jobId, from, to }) => ({
    jobId,
    // Only what changed, so an untouched spelling (`MON`) isn't rewritten as `1`.
    ...(sameSchedule(from.schedule, to.schedule) ? {} : { schedule: to.schedule }),
    ...(from.enabled === to.enabled ? {} : { enabled: to.enabled }),
    expected: { schedule: from.schedule, enabled: from.enabled },
  }));
  const keys = diffScheduleSettings(state.base, state.current);
  const settings =
    keys.length === 0
      ? undefined
      : {
          values: Object.fromEntries(keys.map((k) => [k, state.current.settings[k]])) as Partial<ScheduleSettings>,
          expected: Object.fromEntries(keys.map((k) => [k, state.base.settings[k]])) as Partial<ScheduleSettings>,
        };
  return { jobs, settings, summary: state.summary ?? undefined };
}
