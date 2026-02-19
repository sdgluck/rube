import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsArrs() {
  const [radarrUrl, setRadarrUrl] = useState("");
  const [radarrApiKey, setRadarrApiKey] = useState("");
  const [radarrStatus, setRadarrStatus] = useState<Status | null>(null);
  const [testingRadarr, setTestingRadarr] = useState(false);
  const [savingRadarr, setSavingRadarr] = useState(false);

  const [sonarrUrl, setSonarrUrl] = useState("");
  const [sonarrApiKey, setSonarrApiKey] = useState("");
  const [sonarrStatus, setSonarrStatus] = useState<Status | null>(null);
  const [testingSonarr, setTestingSonarr] = useState(false);
  const [savingSonarr, setSavingSonarr] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();
  const testRadarrMutation = trpc.testRadarr.useMutation();
  const testSonarrMutation = trpc.testSonarr.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setRadarrUrl(configQuery.data.global_radarr_url || "");
      setRadarrApiKey(configQuery.data.global_radarr_api_key || "");
      setSonarrUrl(configQuery.data.global_sonarr_url || "");
      setSonarrApiKey(configQuery.data.global_sonarr_api_key || "");
    }
  }, [configQuery.data]);

  const runRadarrTest = async (url: string, apiKey: string): Promise<boolean> => {
    setRadarrStatus(null);
    if (!url || !apiKey) {
      setRadarrStatus({ type: "error", msg: "Both URL and API key are required" });
      return false;
    }
    setTestingRadarr(true);
    try {
      const result = await testRadarrMutation.mutateAsync({ url, api_key: apiKey });
      if (result.ok) {
        setRadarrStatus({ type: "success", msg: `Connected to "${result.instanceName}"` });
        return true;
      }
      throw "nope";
    } catch {
      setRadarrStatus({ type: "error", msg: "Connection test failed" });
      return false;
    } finally {
      setTestingRadarr(false);
    }
  };

  const handleSaveRadarr = async () => {
    setRadarrStatus(null);
    setSavingRadarr(true);
    try {
      const ok = await runRadarrTest(radarrUrl, radarrApiKey);
      if (!ok) {
        setRadarrStatus({ type: "error", msg: "Radarr connection failed — settings not saved" });
        setSavingRadarr(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        global_radarr_url: radarrUrl,
        global_radarr_api_key: radarrApiKey,
      });
      setRadarrStatus({ type: "success", msg: "Radarr settings saved" });
    } catch {
      setRadarrStatus({ type: "error", msg: "Failed to save Radarr settings" });
    } finally {
      setSavingRadarr(false);
    }
  };

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
        <legend className={styles.groupTitle}>Radarr</legend>
        <label className={styles.field}>
          <span className={styles.label}>Radarr URL</span>
          <input
            type="text"
            className={styles.input}
            placeholder="http://localhost:7878"
            value={radarrUrl}
            onChange={(e) => setRadarrUrl(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter API key"
            value={radarrApiKey}
            onChange={(e) => setRadarrApiKey(e.target.value)}
          />
        </label>
        {radarrStatus && <div className={`${styles.toast} ${styles[radarrStatus.type]}`}>{radarrStatus.msg}</div>}
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveRadarr} disabled={savingRadarr}>
            {savingRadarr ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => runRadarrTest(radarrUrl, radarrApiKey)}
            disabled={testingRadarr}
          >
            {testingRadarr ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </fieldset>

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
