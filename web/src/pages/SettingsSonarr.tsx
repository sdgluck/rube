import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsSonarr() {
  const [sonarrUrl, setSonarrUrl] = useState("");
  const [sonarrApiKey, setSonarrApiKey] = useState("");
  const [sonarrStatus, setSonarrStatus] = useState<Status | null>(null);
  const [testingSonarr, setTestingSonarr] = useState(false);
  const [savingSonarr, setSavingSonarr] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();
  const testSonarrMutation = trpc.testSonarr.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setSonarrUrl(configQuery.data.global_sonarr_url || "");
      setSonarrApiKey(configQuery.data.global_sonarr_api_key || "");
    }
  }, [configQuery.data]);

  const runSonarrTest = async (url: string, apiKey: string): Promise<boolean> => {
    setSonarrStatus(null);
    if (!url || !apiKey) {
      setSonarrStatus({ type: "error", msg: "Both URL and API key are required" });
      return false;
    }
    setTestingSonarr(true);
    try {
      const result = await testSonarrMutation.mutateAsync({ url, api_key: apiKey });
      if (result.ok) {
        setSonarrStatus({ type: "success", msg: `Connected to "${result.instanceName}"` });
        return true;
      }
      throw "nope";
    } catch {
      setSonarrStatus({ type: "error", msg: "Connection test failed" });
      return false;
    } finally {
      setTestingSonarr(false);
    }
  };

  const handleSaveSonarr = async () => {
    setSonarrStatus(null);
    setSavingSonarr(true);
    try {
      const ok = await runSonarrTest(sonarrUrl, sonarrApiKey);
      if (!ok) {
        setSonarrStatus({ type: "error", msg: "Sonarr connection failed — settings not saved" });
        setSavingSonarr(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        global_sonarr_url: sonarrUrl,
        global_sonarr_api_key: sonarrApiKey,
      });
      setSonarrStatus({ type: "success", msg: "Sonarr settings saved" });
    } catch {
      setSonarrStatus({ type: "error", msg: "Failed to save Sonarr settings" });
    } finally {
      setSavingSonarr(false);
    }
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Sonarr</legend>
        <label className={styles.field}>
          <span className={styles.label}>Sonarr URL</span>
          <input
            type="text"
            className={styles.input}
            placeholder="http://localhost:8989"
            value={sonarrUrl}
            onChange={(e) => setSonarrUrl(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter API key"
            value={sonarrApiKey}
            onChange={(e) => setSonarrApiKey(e.target.value)}
          />
        </label>
        {sonarrStatus && <div className={`${styles.toast} ${styles[sonarrStatus.type]}`}>{sonarrStatus.msg}</div>}
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveSonarr} disabled={savingSonarr}>
            {savingSonarr ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => runSonarrTest(sonarrUrl, sonarrApiKey)}
            disabled={testingSonarr}
          >
            {testingSonarr ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
