import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsNotificationsPushover() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setApiKey(configQuery.data.global_pushover_api_key || "");
    }
  }, [configQuery.data]);

  const handleSave = async () => {
    setStatus(null);
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_pushover_api_key: apiKey,
      });
      setStatus({ type: "success", msg: "Pushover settings saved" });
    } catch {
      setStatus({ type: "error", msg: "Failed to save Pushover settings" });
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Pushover</legend>
        <label className={styles.field}>
          <span className={styles.label}>API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter Pushover API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className={styles.hint}>Get a key at pushover.net</span>
        </label>
        {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}
        <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </fieldset>
    </div>
  );
}
