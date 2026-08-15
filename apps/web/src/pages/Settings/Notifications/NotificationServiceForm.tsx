import { useState, useEffect, useMemo } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import styles from "#pages/Settings/Settings.module.css";
import CardSection from "#components/CardSection";

export interface NotificationField {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "checkbox";
  placeholder?: string;
  hint?: string;
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
  const [values, setValues] = useState<Record<string, string | boolean>>({});
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

  useEffect(() => {
    if (configQuery.data) {
      const data = configQuery.data as Record<string, unknown>;
      const source = objectKey ? ((data[objectKey] as Record<string, unknown>) ?? {}) : data;
      const vals: Record<string, string | boolean> = {};
      for (const field of fields) {
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
          field.type === "checkbox" ? (
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
              <input
                type={field.type || "text"}
                className={styles.input}
                placeholder={field.placeholder}
                value={String(values[field.key] ?? "")}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
              {field.hint && <span className={styles.hint}>{field.hint}</span>}
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
        <span className={styles.hint}>Select which events trigger a {title} notification.</span>
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
          <span className={styles.hint}>Limit job event notifications to specific jobs, or notify on all.</span>
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
          <span className={styles.hint}>Limit health event notifications to specific targets, or notify on all.</span>
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
