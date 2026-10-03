import { useState, useEffect, useMemo } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import styles from "#pages/Settings/Settings.module.css";
import CardSection from "#components/CardSection";

export type FieldValues = Record<string, string | boolean>;

/** The typed vanilla client, for a field action to call the server with. */
export type TrpcProxy = ReturnType<typeof trpc.useUtils>["client"];

export interface FieldAction {
  label: string;
  /** Shown on the button while `run` is in flight. */
  busyLabel: string;
  /** Works out the field's value from the rest of the form; throws to say why it couldn't. */
  run: (values: FieldValues, client: TrpcProxy) => Promise<{ value: string; message: string }>;
}

/**
 * Runs a field's `action` and writes its answer into the form. Shared by the
 * Settings form and the onboarding card, which render the same field list.
 */
export function useFieldAction(setValues: (update: (prev: FieldValues) => FieldValues) => void) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const [running, setRunning] = useState<string | null>(null);

  async function runAction(field: NotificationField, values: FieldValues) {
    if (!field.action) return;
    setRunning(field.key);
    try {
      const { value, message } = await field.action.run(values, utils.client);
      setValues((prev) => ({ ...prev, [field.key]: value }));
      addToast(message, "success");
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setRunning(null);
    }
  }

  return { runAction, running };
}

export interface NotificationField {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "checkbox";
  placeholder?: string;
  hint?: string;
  /** Stored and saved as usual, but edited through a `derived` control instead. */
  hidden?: boolean;
  /**
   * A select with no stored key of its own: it reads its value from other
   * fields and writes back to them. This is how a better control can sit over
   * an existing stored shape (SMTP's encryption over `secure` + `port`)
   * without a config migration or a change to what exports carry.
   */
  derived?: {
    options: { value: string; label: string }[];
    read: (values: FieldValues) => string;
    write: (value: string, values: FieldValues) => FieldValues;
  };
  /** An example shown in a collapsed block under the field. */
  sample?: string;
  /** A button beside the input that fills it in, so the hint needn't explain how. */
  action?: FieldAction;
}

interface Props {
  service: string;
  title: string;
  fields: NotificationField[];
  eventsKey: string;
  jobsKey: string;
  healthTargetsKey: string;
  /**
   * When set, `fields` are keys *inside* this config object rather than
   * top-level config keys — SMTP is stored as one `global_smtp` blob, because
   * its six settings are meaningless apart from each other. The read and write
   * paths both nest, so the rest of this form is unchanged.
   */
  objectKey?: string;
}

type FilterMode = "all" | "specific";

export default function NotificationServiceForm({
  service,
  title,
  fields,
  eventsKey,
  jobsKey,
  healthTargetsKey,
  objectKey,
}: Props) {
  const [values, setValues] = useState<FieldValues>({});
  const [enabledEvents, setEnabledEvents] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [jobsMode, setJobsMode] = useState<FilterMode>("all");
  const [selectedHealthTargets, setSelectedHealthTargets] = useState<string[]>([]);
  const [healthMode, setHealthMode] = useState<FilterMode>("all");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // Snapshot of the loaded config, for dirty comparison. The Arrs and Databases
  // forms have had unsaved-change protection all along; this one did not, so
  // navigating away silently discarded edits.
  const [pristine, setPristine] = useState<string | null>(null);

  const { addToast } = useToast();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const eventTypesQuery = trpc.notificationEventTypes.useQuery(undefined, { refetchOnWindowFocus: false });
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const healthQuery = trpc.health.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testMutation = trpc.testNotification.useMutation();
  const { runAction, running } = useFieldAction(setValues);

  useEffect(() => {
    if (configQuery.data) {
      const data = configQuery.data as Record<string, unknown>;
      const source = objectKey ? ((data[objectKey] as Record<string, unknown>) ?? {}) : data;
      const vals: FieldValues = {};
      for (const field of fields) {
        if (field.derived) continue;
        if (field.type === "checkbox") {
          vals[field.key] = (source[field.key] as boolean) ?? false;
        } else {
          vals[field.key] = String(source[field.key] ?? "");
        }
      }
      setValues(vals);
      setEnabledEvents((data[eventsKey] as string[]) ?? []);
      const jobs = (data[jobsKey] as string[]) ?? [];
      setSelectedJobs(jobs);
      setJobsMode(jobs.length > 0 ? "specific" : "all");
      const targets = (data[healthTargetsKey] as string[]) ?? [];
      setSelectedHealthTargets(targets);
      setHealthMode(targets.length > 0 ? "specific" : "all");
      setPristine(
        JSON.stringify({
          vals,
          events: (data[eventsKey] as string[]) ?? [],
          jobs,
          targets,
        }),
      );
    }
  }, [configQuery.data, eventsKey, jobsKey, healthTargetsKey, fields, objectKey]);

  const current = useMemo(
    () =>
      JSON.stringify({
        vals: values,
        events: enabledEvents,
        jobs: jobsMode === "all" ? [] : selectedJobs,
        targets: healthMode === "all" ? [] : selectedHealthTargets,
      }),
    [values, enabledEvents, jobsMode, selectedJobs, healthMode, selectedHealthTargets],
  );

  const isDirty = pristine !== null && current !== pristine;
  useUnsavedChanges(isDirty);

  function buildConfigPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const target: Record<string, unknown> = objectKey ? {} : payload;
    for (const field of fields) {
      if (field.derived) continue;
      if (field.type === "number") {
        target[field.key] = Number(values[field.key]) || 0;
      } else if (field.type === "checkbox") {
        target[field.key] = !!values[field.key];
      } else {
        target[field.key] = values[field.key] || "";
      }
    }
    if (objectKey) payload[objectKey] = target;
    payload[eventsKey] = enabledEvents;
    payload[jobsKey] = jobsMode === "all" ? [] : selectedJobs;
    payload[healthTargetsKey] = healthMode === "all" ? [] : selectedHealthTargets;
    return payload;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveConfigMutation.mutateAsync(buildConfigPayload() as any);
      utils.config.get.invalidate();
      addToast(`${title} settings saved`, "success");
    } catch {
      addToast(`Failed to save ${title} settings`, "error");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Test sends using the *saved* configuration. It used to silently write the
   * form's current values first, so clicking "Test" persisted changes the user
   * hadn't chosen to save — and the sibling service forms didn't do that.
   */
  const handleTest = async () => {
    if (isDirty) {
      addToast("Save your changes before sending a test notification", "error");
      return;
    }
    setTesting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await testMutation.mutateAsync({ service: service as any });
      addToast("Test notification sent", "success");
    } catch (err) {
      addToast(`Failed to send test notification: ${(err as Error).message}`, "error");
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  const toggleEvent = (eventId: string) => {
    setEnabledEvents((prev) => (prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]));
  };

  const toggleJob = (jobId: string) => {
    setSelectedJobs((prev) => (prev.includes(jobId) ? prev.filter((j) => j !== jobId) : [...prev, jobId]));
  };

  const toggleHealthTarget = (target: string) => {
    setSelectedHealthTargets((prev) => (prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target]));
  };

  if (configQuery.isLoading) return <FormSkeleton rows={4} />;
  if (configQuery.error) {
    return (
      <ErrorState title="Couldn't load settings" error={configQuery.error} onRetry={() => configQuery.refetch()} />
    );
  }

  const eventTypes = eventTypesQuery.data || [];
  const jobsList = jobsQuery.data ?? [];
  const healthList = healthQuery.data ?? [];
  const hasJobEvents = enabledEvents.some((e) => e.startsWith("job."));
  const hasHealthEvents = enabledEvents.some((e) => e.startsWith("health."));

  return (
    <div className={styles.form}>
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title={title}>
        {fields.map((field) =>
          field.hidden ? null : field.derived ? (
            <label key={field.key} className={styles.field}>
              <span className={styles.label}>{field.label}</span>
              <select
                className={styles.input}
                value={field.derived.read(values)}
                onChange={(e) => {
                  const patch = field.derived!.write(e.target.value, values);
                  setValues((prev) => ({ ...prev, ...patch }));
                }}
              >
                {field.derived.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {field.hint && <span className={styles.hint}>{field.hint}</span>}
            </label>
          ) : field.type === "checkbox" ? (
            <label key={field.key} className={styles.libraryItem}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={!!values[field.key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.checked }))}
              />
              <span>{field.label}</span>
              {field.hint && <span className={styles.hint}>{field.hint}</span>}
            </label>
          ) : (
            <label key={field.key} className={styles.field}>
              <span className={styles.label}>{field.label}</span>
              <span className={field.action ? styles.inputAction : undefined}>
                <input
                  type={field.type || "text"}
                  className={styles.input}
                  placeholder={field.placeholder}
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
                {field.action && (
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => runAction(field, values)}
                    disabled={running !== null}
                  >
                    {running === field.key ? field.action.busyLabel : field.action.label}
                  </button>
                )}
              </span>
              {field.hint && <span className={styles.hint}>{field.hint}</span>}
              {field.sample && (
                <details className={styles.sample}>
                  <summary>Sample payload</summary>
                  <pre>{field.sample}</pre>
                </details>
              )}
            </label>
          ),
        )}
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Sending…" : "Test"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Events">
        {eventTypes.length === 0 ? (
          <p className={styles.hint}>Loading event types…</p>
        ) : (
          <div className={styles.libraryList}>
            {eventTypes.map((evt) => (
              <label key={evt.id} className={styles.libraryItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={enabledEvents.includes(evt.id)}
                  onChange={() => toggleEvent(evt.id)}
                />
                <span>{evt.label}</span>
              </label>
            ))}
          </div>
        )}
      </CardSection>

      {hasJobEvents && (
        <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Jobs">
          <label className={styles.libraryItem}>
            <input
              type="radio"
              name={`${service}-jobs-mode`}
              checked={jobsMode === "all"}
              onChange={() => setJobsMode("all")}
            />
            <span>All jobs</span>
          </label>
          <label className={styles.libraryItem}>
            <input
              type="radio"
              name={`${service}-jobs-mode`}
              checked={jobsMode === "specific"}
              onChange={() => setJobsMode("specific")}
            />
            <span>Only selected jobs</span>
          </label>
          {jobsMode === "specific" && (
            <div className={styles.libraryList}>
              {jobsList.length === 0 ? (
                <p className={styles.hint}>No jobs found.</p>
              ) : (
                jobsList.map((job) => (
                  <label key={job.id} className={styles.libraryItem}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selectedJobs.includes(job.id)}
                      onChange={() => toggleJob(job.id)}
                    />
                    <span>{job.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </CardSection>
      )}

      {hasHealthEvents && (
        <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Health Check Targets">
          <label className={styles.libraryItem}>
            <input
              type="radio"
              name={`${service}-health-mode`}
              checked={healthMode === "all"}
              onChange={() => setHealthMode("all")}
            />
            <span>All targets</span>
          </label>
          <label className={styles.libraryItem}>
            <input
              type="radio"
              name={`${service}-health-mode`}
              checked={healthMode === "specific"}
              onChange={() => setHealthMode("specific")}
            />
            <span>Only selected targets</span>
          </label>
          {healthMode === "specific" && (
            <div className={styles.libraryList}>
              {healthList.length === 0 ? (
                <p className={styles.hint}>No health targets found.</p>
              ) : (
                healthList.map((target) => (
                  <label key={target.service} className={styles.libraryItem}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selectedHealthTargets.includes(target.service)}
                      onChange={() => toggleHealthTarget(target.service)}
                    />
                    <span>{target.service}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </CardSection>
      )}
    </div>
  );
}
