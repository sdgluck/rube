import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsNotificationsPushover() {
  const [apiKey, setApiKey] = useState("");
  const [userKey, setUserKey] = useState("");
  const [enabledEvents, setEnabledEvents] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const eventTypesQuery = trpc.pushoverEventTypes.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testPushoverMutation = trpc.testPushover.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setApiKey(configQuery.data.global_pushover_api_key || "");
      setUserKey(configQuery.data.global_pushover_user_key || "");
      setEnabledEvents(configQuery.data.global_pushover_events || []);
    }
  }, [configQuery.data]);

  const toggleEvent = (eventId: string) => {
    setEnabledEvents((prev) => (prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]));
  };

  const handleSave = async () => {
    setStatus(null);
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_pushover_api_key: apiKey,
        global_pushover_user_key: userKey,
        global_pushover_events: enabledEvents,
      });
      setStatus({ type: "success", msg: "Pushover settings saved" });
    } catch {
      setStatus({ type: "error", msg: "Failed to save Pushover settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setStatus(null);
    if (!apiKey || !userKey) {
      setStatus({ type: "error", msg: "API key and user key are required" });
      return;
    }
    setTesting(true);
    try {
      // Save first so the server has the keys
      await saveConfigMutation.mutateAsync({
        global_pushover_api_key: apiKey,
        global_pushover_user_key: userKey,
        global_pushover_events: enabledEvents,
      });
      const result = await testPushoverMutation.mutateAsync();
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

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const eventTypes = eventTypesQuery.data || [];

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Pushover</legend>
        <label className={styles.field}>
          <span className={styles.label}>API Key (Application Token)</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter Pushover API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className={styles.hint}>Create an application at pushover.net to get a token</span>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>User Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter Pushover user key"
            value={userKey}
            onChange={(e) => setUserKey(e.target.value)}
          />
          <span className={styles.hint}>Found on your Pushover dashboard</span>
        </label>
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
        <span className={styles.hint}>Select which events trigger a Pushover notification.</span>
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
