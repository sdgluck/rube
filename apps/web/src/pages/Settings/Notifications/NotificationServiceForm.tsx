import { useState, useEffect } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { FormSkeleton } from "#components/Skeleton";
import styles from "#pages/Settings/Settings.module.css";

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
}

type FilterMode = "all" | "specific";

export default function NotificationServiceForm({
  service,
  title,
  fields,
  eventsKey,
  jobsKey,
  healthTargetsKey,
}: Props) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [enabledEvents, setEnabledEvents] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [jobsMode, setJobsMode] = useState<FilterMode>("all");
  const [selectedHealthTargets, setSelectedHealthTargets] = useState<string[]>([]);
  const [healthMode, setHealthMode] = useState<FilterMode>("all");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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
      const vals: Record<string, string | boolean> = {};
      for (const field of fields) {
        if (field.type === "checkbox") {
          vals[field.key] = (data[field.key] as boolean) ?? false;
        } else {
          vals[field.key] = String(data[field.key] ?? "");
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
    }
  }, [configQuery.data, eventsKey, jobsKey, healthTargetsKey, fields]);

  function buildConfigPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "number") {
        payload[field.key] = Number(values[field.key]) || 0;
      } else if (field.type === "checkbox") {
        payload[field.key] = !!values[field.key];
      } else {
        payload[field.key] = values[field.key] || "";
      }
    }
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

  const handleTest = async () => {
    setTesting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveConfigMutation.mutateAsync(buildConfigPayload() as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await testMutation.mutateAsync({ service: service as any });
      if (result.ok) {
        addToast("Test notification sent", "success");
      } else {
        addToast(result.error || "Failed to send test notification", "error");
      }
    } catch {
      addToast("Failed to send test notification", "error");
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
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const eventTypes = eventTypesQuery.data || [];
  const jobsList = jobsQuery.data ?? [];
  const healthList = healthQuery.data ?? [];
  const hasJobEvents = enabledEvents.some((e) => e.startsWith("job."));
  const hasHealthEvents = enabledEvents.some((e) => e.startsWith("health."));

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>{title}</legend>
        {fields.map((field) =>
          field.type === "checkbox" ? (
            <label key={field.key} className={styles.libraryItem}>
              <input
                type="checkbox"
                className={styles.toggle}
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
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Sending..." : "Test"}
          </button>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Events</legend>
        <span className={styles.hint}>Select which events trigger a {title} notification.</span>
        {eventTypes.length === 0 ? (
          <p className={styles.hint}>Loading event types...</p>
        ) : (
          <div className={styles.libraryList}>
            {eventTypes.map((evt) => (
              <label key={evt.id} className={styles.libraryItem}>
                <input
                  type="checkbox"
                  className={styles.toggle}
                  checked={enabledEvents.includes(evt.id)}
                  onChange={() => toggleEvent(evt.id)}
                />
                <span>{evt.label}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {hasJobEvents && (
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Jobs</legend>
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
                      className={styles.toggle}
                      checked={selectedJobs.includes(job.id)}
                      onChange={() => toggleJob(job.id)}
                    />
                    <span>{job.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>
      )}

      {hasHealthEvents && (
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Health Check Targets</legend>
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
                      className={styles.toggle}
                      checked={selectedHealthTargets.includes(target.service)}
                      onChange={() => toggleHealthTarget(target.service)}
                    />
                    <span>{target.service}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
