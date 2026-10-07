import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import {
  applyFix,
  diffSchedulePlans,
  diffScheduleSettings,
  effectiveTimezone,
  hasBlockingIssues,
  isSchedulableJob,
  planFromContext,
  validateSchedulePlan,
  type ScheduleContext,
  type ScheduleFix,
  type ScheduleIssue,
  type SchedulePlan,
  type ScheduleSeverity,
  type ScheduleSettings,
} from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import PageShell, { StatusChip } from "#components/PageShell";
import ErrorState from "#components/ErrorState";
import { FormSkeleton } from "#components/Skeleton";
import CardSection from "#components/CardSection";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import controls from "#/styles/controls.module.css";
import { draftReducer, initialDraft, isDirty, toMutation } from "./scheduleDraft";
import Timeline, { onTimeline } from "./Timeline";
import { DAY_MINUTES, WEEK_MINUTES, type TimelineSpan } from "./timelineMath";
import JobEditor from "./JobEditor";
import IssuesPanel from "./IssuesPanel";
import PresetPicker from "./PresetPicker";
import ChangesPanel from "./ChangesPanel";
import SettingsCard from "./SettingsCard";
import OtherJobs from "./OtherJobs";
import styles from "./Schedule.module.css";

/**
 * Jobs → Schedule: the whole night on one screen.
 *
 * Everything here edits a draft. Dragging, the job editor, a preset, a fix
 * from the problems list and the settings all land in the same undoable state,
 * which is validated on every change by the same function the server runs on
 * save — and nothing reaches the scheduler until Save, as one transaction.
 */

const EMPTY_PLAN: SchedulePlan = {
  jobs: {},
  settings: {
    timezone: "",
    maintenanceWindow: { enabled: false, from: "01:00", to: "06:00" },
    deferWhileStreaming: { enabled: false, maxWaitMinutes: 120, transcodesOnly: false },
  },
};

const RANK: Record<ScheduleSeverity, number> = { error: 0, warning: 1, info: 2 };

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || (el as HTMLElement).isContentEditable;
}

export default function JobSchedule() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const query = trpc.jobs.scheduleContext.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.jobs.updateSchedules.useMutation();
  const [state, dispatch] = useReducer(draftReducer, EMPTY_PLAN, initialDraft);
  const [span, setSpan] = useState<TimelineSpan>(DAY_MINUTES);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());

  const dirty = isDirty(state);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty);

  // Take the server's state whenever it changes and there's nothing unsaved to
  // lose — on load, and after a save's refetch.
  useEffect(() => {
    if (query.data && !dirtyRef.current) dispatch({ type: "load", plan: planFromContext(query.data) });
  }, [query.data]);

  const ctx: ScheduleContext | undefined = query.data;
  const visible = state.preview ?? state.current;
  const timezone = ctx ? effectiveTimezone(visible, ctx) : "UTC";

  const issues = useMemo(() => (ctx ? validateSchedulePlan(visible, ctx) : []), [ctx, visible]);
  const blocking = hasBlockingIssues(issues);
  const severityByJob = useMemo(() => {
    const map = new Map<string, ScheduleSeverity>();
    for (const issue of issues) {
      for (const id of issue.jobIds) {
        const prev = map.get(id);
        if (!prev || RANK[issue.severity] < RANK[prev]) map.set(id, issue.severity);
      }
    }
    return map;
  }, [issues]);

  const groups = useMemo(() => {
    const jobs = (ctx?.jobs ?? []).filter((j) => isSchedulableJob(j.id) && visible.jobs[j.id]);
    return {
      all: jobs,
      timeline: jobs.filter((j) => onTimeline(visible.jobs[j.id].schedule, timezone)),
      recurring: jobs.filter(
        (j) => visible.jobs[j.id].schedule !== "" && !onTimeline(visible.jobs[j.id].schedule, timezone),
      ),
      manual: jobs.filter((j) => visible.jobs[j.id].schedule === ""),
    };
  }, [ctx, visible, timezone]);

  const changeCount =
    diffSchedulePlans(state.base, state.current).length + diffScheduleSettings(state.base, state.current).length;

  const handleSave = useCallback(async () => {
    try {
      const result = await save.mutateAsync(toMutation(state));
      dispatch({ type: "saved" });
      setHighlighted(new Set());
      utils.jobs.list.invalidate();
      utils.config.get.invalidate();
      utils.config.effectiveTimezone.invalidate();
      await utils.jobs.scheduleContext.invalidate();
      const names = new Map((ctx?.jobs ?? []).map((j) => [j.id, j.name]));
      const skipped = result.skippedToday.map((id) => names.get(id) ?? id);
      addToast(
        skipped.length > 0
          ? `Schedule saved. ${skipped.join(", ")} won't run again today — ${skipped.length === 1 ? "its" : "their"} new time has already passed.`
          : "Schedule saved",
        "success",
      );
    } catch (err) {
      if ((err as { data?: { code?: string } }).data?.code === "CONFLICT") {
        const fresh = await utils.jobs.scheduleContext.fetch();
        dispatch({ type: "rebase", server: planFromContext(fresh) });
        addToast(
          "Someone else changed the schedule while you were editing. Your changes are kept on top of theirs — check them and save again.",
          "error",
          { duration: 10_000 },
        );
        return;
      }
      addToast(`Couldn't save: ${(err as Error).message}`, "error");
    }
  }, [addToast, ctx, save, state, utils]);

  // ⌘Z / ⇧⌘Z, unless a field has focus and wants them for itself.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || isInputFocused()) return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? "redo" : "undo" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const applyIssueFix = (fix: ScheduleFix) => dispatch({ type: "apply", plan: applyFix(state.current, fix) });
  const focusIssue = (issue: ScheduleIssue) => {
    setHighlighted(new Set(issue.jobIds));
    if (issue.jobIds[0]) setSelected(issue.jobIds[issue.jobIds.length - 1]);
  };

  if (query.isLoading) return <FormSkeleton rows={6} />;
  if (query.error || !ctx) {
    return <ErrorState title="Couldn't load the schedule" error={query.error} onRetry={() => query.refetch()} />;
  }

  const notInstalled = query.data?.notInstalled ?? [];
  const selectedJob = selected ? ctx.jobs.find((j) => j.id === selected) : undefined;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  return (
    <PageShell
      chip={
        errors > 0 ? (
          <StatusChip tone="error">
            {errors} error{errors === 1 ? "" : "s"}
          </StatusChip>
        ) : warnings > 0 ? (
          <StatusChip tone="advisory">
            {warnings} warning{warnings === 1 ? "" : "s"}
          </StatusChip>
        ) : (
          <StatusChip tone="ok">No problems</StatusChip>
        )
      }
      actions={
        <>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
            onClick={() => dispatch({ type: "undo" })}
            disabled={state.past.length === 0}
            aria-label="Undo"
            title="Undo (⌘Z)"
          >
            <Undo2 size="1.5rem" />
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
            onClick={() => dispatch({ type: "redo" })}
            disabled={state.future.length === 0}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
          >
            <Redo2 size="1.5rem" />
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            onClick={() => dispatch({ type: "discard" })}
            disabled={!dirty}
          >
            Discard
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
            onClick={handleSave}
            disabled={!dirty || blocking || save.isPending}
            title={blocking ? "Fix the problems marked “Blocks saving” first" : undefined}
          >
            {save.isPending ? "Saving…" : changeCount > 0 ? `Save · ${changeCount}` : "Save"}
          </button>
        </>
      }
    >
      <div className={styles.page}>
        <div className={styles.main}>
          <CardSection className={styles.section} titleClassName={styles.sectionTitle} title="Start from a preset">
            <PresetPicker
              ctx={ctx}
              current={state.current}
              onApply={(plan, name) => {
                dispatch({ type: "apply", plan, summary: `Applied the ${name} preset` });
                addToast(`${name} loaded — review the changes, then save`, "info");
              }}
            />
          </CardSection>

          <CardSection
            className={styles.section}
            titleClassName={styles.sectionTitle}
            title={
              <span className={styles.sectionTitleRow}>
                <span>Timeline</span>
                <span className={styles.timelineMeta}>{timezone}</span>
                <span className={controls.segmented} role="radiogroup" aria-label="Timeline span">
                  {(
                    [
                      [DAY_MINUTES, "Day"],
                      [WEEK_MINUTES, "Week"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={span === value}
                      className={`${controls.segmentedItem} ${span === value ? controls.segmentedItemActive : ""}`}
                      onClick={() => setSpan(value)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </span>
            }
          >
            <Timeline
              jobs={groups.timeline}
              plan={visible}
              span={span}
              timezone={timezone}
              now={Date.now()}
              severityByJob={severityByJob}
              selected={selected}
              highlighted={highlighted}
              onSelect={setSelected}
              onMove={(jobId, cron, preview) =>
                dispatch({ type: "set-job", jobId, patch: { schedule: cron }, preview })
              }
              onCommit={() => dispatch({ type: "commit-preview" })}
              onCancel={() => dispatch({ type: "cancel-preview" })}
              onDropManual={(jobId, minute) => {
                dispatch({
                  type: "set-job",
                  jobId,
                  patch: { schedule: `${minute % 60} ${Math.floor(minute / 60)} * * *` },
                });
                setSelected(jobId);
              }}
            />
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendWindow} /> Maintenance window
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendBlock} /> Typical run
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendEstimate} /> Estimate — not run yet
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendNow} /> Now
              </span>
              <span className={styles.legendNote}>Drag a block, or focus it and use ← →, to move it.</span>
            </div>
          </CardSection>

          <div className={styles.columns}>
            <CardSection className={styles.section} titleClassName={styles.sectionTitle} title="Repeating">
              <OtherJobs
                kind="recurring"
                jobs={groups.recurring}
                plan={visible.jobs}
                selected={selected}
                severityByJob={severityByJob}
                onSelect={setSelected}
                onChange={(jobId, patch) => dispatch({ type: "set-job", jobId, patch })}
              />
            </CardSection>
            <CardSection className={styles.section} titleClassName={styles.sectionTitle} title="Only when started">
              <OtherJobs
                kind="manual"
                jobs={groups.manual}
                plan={visible.jobs}
                selected={selected}
                severityByJob={severityByJob}
                onSelect={setSelected}
                onChange={(jobId, patch) => dispatch({ type: "set-job", jobId, patch })}
              />
              <p className={styles.muted}>Drag one onto the timeline to give it a daily time.</p>
              {notInstalled.length > 0 && (
                <p className={styles.muted}>
                  Not installed: {notInstalled.map((f) => f.name).join(", ")}. Add them from the Overview tab&rsquo;s
                  Features panel.
                </p>
              )}
            </CardSection>
          </div>
        </div>

        <aside className={styles.side}>
          <CardSection className={styles.section} titleClassName={styles.sectionTitle} title="Job">
            {selectedJob && visible.jobs[selectedJob.id] ? (
              <JobEditor
                key={selectedJob.id}
                job={selectedJob}
                entry={visible.jobs[selectedJob.id]}
                saved={state.base.jobs[selectedJob.id]}
                timezone={timezone}
                onChange={(patch) => dispatch({ type: "set-job", jobId: selectedJob.id, patch })}
              />
            ) : (
              <p className={styles.muted}>Select a job on the timeline or in the lists to edit its schedule.</p>
            )}
          </CardSection>

          <CardSection
            className={styles.section}
            titleClassName={styles.sectionTitle}
            title={`Problems${issues.length > 0 ? ` · ${issues.length}` : ""}`}
          >
            <IssuesPanel issues={issues} onFix={applyIssueFix} onFocus={focusIssue} />
          </CardSection>

          {dirty && (
            <CardSection
              className={styles.section}
              titleClassName={styles.sectionTitle}
              title={`Unsaved · ${changeCount}`}
            >
              <ChangesPanel
                jobs={ctx.jobs}
                base={state.base}
                current={state.current}
                onRevert={(jobId) => dispatch({ type: "revert-job", jobId })}
                onRevertSetting={(key: keyof ScheduleSettings) =>
                  dispatch({ type: "set-settings", patch: { [key]: state.base.settings[key] } })
                }
              />
            </CardSection>
          )}

          <CardSection className={styles.section} titleClassName={styles.sectionTitle} title="Timezone & holding back">
            <SettingsCard
              settings={visible.settings}
              serverTimezone={ctx.serverTimezone}
              onChange={(patch) => dispatch({ type: "set-settings", patch })}
            />
          </CardSection>
        </aside>
      </div>
    </PageShell>
  );
}
