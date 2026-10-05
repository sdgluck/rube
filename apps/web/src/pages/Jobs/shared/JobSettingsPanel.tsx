/**
 * The Configuration card every job page uses: schedule, on/off, and the
 * command's own settings, with one Save for all of it.
 *
 * On/off stays instant — it is a switch, and people expect switches to act —
 * but schedule and settings are one draft, saved together as a single change
 * (one change-history row, one validation pass on the server).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fieldsFor, jobScheduleMeta } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import type { Job } from "#pages/Jobs/types";
import { jobUi } from "#pages/Jobs/presentation";
import ConfigPanel from "./ConfigPanel";
import JobSettingsForm, { draftErrors } from "./JobSettingsForm";
import EnabledRow from "./rows/EnabledRow";
import ScheduleRow from "./rows/ScheduleRow";
import { draftFromConfig, patchFromDraft, type Draft } from "./config-draft";
import styles from "#pages/Jobs/Jobs.module.css";

interface Props {
  job: Job;
  /** Extra rows after the settings — a link to the rules a job runs, say. */
  children?: ReactNode;
}

export default function JobSettingsPanel({ job, children }: Props) {
  const ui = jobUi(job);
  const fields = useMemo(() => fieldsFor(job.command), [job.command]);
  const stored = (job.config ?? {}) as Record<string, unknown>;
  const storedKey = JSON.stringify(stored);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const [draft, setDraft] = useState<Draft>(() => draftFromConfig(fields, stored));
  const [schedule, setSchedule] = useState(job.schedule);
  const [serverError, setServerError] = useState<string>();

  // Reset when the saved job changes underneath — after our own save, or
  // another tab's. The list polls, so keying on the content (not the object)
  // stops every poll from wiping an edit in progress.
  useEffect(() => {
    setDraft(draftFromConfig(fields, JSON.parse(storedKey)));
    setSchedule(job.schedule);
    setServerError(undefined);
  }, [fields, storedKey, job.schedule]);

  const mutation = trpc.jobs.update.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      addToast(`${job.name} saved`, "success");
    },
    onError: (err) => {
      setServerError(err.message);
      addToast(err.message, "error");
    },
  });

  const scheduleEditable = ui.schedule !== "hidden";
  const patch = patchFromDraft(fields, stored, draft);
  const scheduleChanged = scheduleEditable && schedule.trim() !== job.schedule;
  const dirty = Object.keys(patch).length > 0 || scheduleChanged;
  const errors = draftErrors(fields, draft);
  const hasEditable = scheduleEditable || fields.length > 0;

  const save = () => {
    setServerError(undefined);
    mutation.mutate({
      jobId: job.id,
      ...(scheduleChanged ? { schedule: schedule.trim() } : {}),
      ...(Object.keys(patch).length > 0 ? { configPatch: patch } : {}),
    });
  };

  return (
    <ConfigPanel
      save={
        hasEditable
          ? { dirty, onSave: save, pending: mutation.isPending, blocked: Object.keys(errors).length > 0 }
          : undefined
      }
    >
      {scheduleEditable && (
        <ScheduleRow
          value={schedule}
          allowSeconds={jobScheduleMeta(job.id).allowSeconds}
          onChange={(next) => {
            setSchedule(next);
            setServerError(undefined);
          }}
        />
      )}
      {ui.enabled === "toggleable" && <EnabledRow jobId={job.id} enabled={!!job.enabled} />}
      <JobSettingsForm fields={fields} draft={draft} onChange={setDraft} errors={errors} />
      {children}
      {serverError && (
        <tr>
          <td colSpan={2}>
            <div role="alert" className={styles.fieldHelpError}>
              {serverError}
            </div>
          </td>
        </tr>
      )}
    </ConfigPanel>
  );
}
