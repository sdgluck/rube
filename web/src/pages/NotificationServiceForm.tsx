import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

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
}

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function NotificationServiceForm({ service, title, fields, eventsKey }: Props) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [enabledEvents, setEnabledEvents] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const eventTypesQuery = trpc.notificationEventTypes.useQuery(undefined, { refetchOnWindowFocus: false });
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
    }
  }, [configQuery.data, eventsKey, fields]);

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
    return payload;
  }

  const handleSave = async () => {
    setStatus(null);
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveConfigMutation.mutateAsync(buildConfigPayload() as any);
      utils.config.get.invalidate();
      setStatus({ type: "success", msg: `${title} settings saved` });
    } catch {
      setStatus({ type: "error", msg: `Failed to save ${title} settings` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setStatus(null);
    setTesting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveConfigMutation.mutateAsync(buildConfigPayload() as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await testMutation.mutateAsync({ service: service as any });
      if (result.ok) {
        setStatus({ type: "success", msg: "Test notification sent" });
      } else {
        setStatus({ type: "error", msg: result.error || "Failed to send test notification" });
      }
    } catch {
      setStatus({ type: "error", msg: "Failed to send test notification" });
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  const toggleEvent = (eventId: string) => {
    setEnabledEvents((prev) => (prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]));
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const eventTypes = eventTypesQuery.data || [];

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
        {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}
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
    </div>
  );
}
