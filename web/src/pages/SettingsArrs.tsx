import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

interface ServiceConfig {
  title: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlConfigKey: string;
  apiKeyConfigKey: string;
  testMutation:
    | ReturnType<typeof trpc.testRadarr.useMutation>
    | ReturnType<typeof trpc.testSonarr.useMutation>
    | ReturnType<typeof trpc.testSeerr.useMutation>;
  formatSuccess: (result: { ok: boolean; instanceName?: string; total?: number }) => string;
  serviceName: string;
}

function ServiceConfigFieldset({
  config,
  configData,
  saveConfigMutation,
  utils,
}: {
  config: ServiceConfig;
  configData: Record<string, string>;
  saveConfigMutation: ReturnType<typeof trpc.config.save.useMutation>;
  utils: ReturnType<typeof trpc.useUtils>;
}) {
  const [url, setUrl] = useState(configData[config.urlConfigKey] || "");
  const [apiKey, setApiKey] = useState(configData[config.apiKeyConfigKey] || "");
  const [status, setStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUrl(configData[config.urlConfigKey] || "");
    setApiKey(configData[config.apiKeyConfigKey] || "");
  }, [configData, config.urlConfigKey, config.apiKeyConfigKey]);

  const runTest = async (testUrl: string, testApiKey: string): Promise<boolean> => {
    setStatus(null);
    if (!testUrl || !testApiKey) {
      setStatus({ type: "error", msg: "Both URL and API key are required" });
      return false;
    }
    setTesting(true);
    try {
      const result = await config.testMutation.mutateAsync({ url: testUrl, api_key: testApiKey });
      if (result.ok) {
        setStatus({ type: "success", msg: config.formatSuccess(result as never) });
        return true;
      }
      throw "nope";
    } catch {
      setStatus({ type: "error", msg: "Connection test failed" });
      return false;
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  const handleSave = async () => {
    setStatus(null);
    setSaving(true);
    try {
      const ok = await runTest(url, apiKey);
      if (!ok) {
        setStatus({ type: "error", msg: `${config.serviceName} connection failed — settings not saved` });
        setSaving(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        [config.urlConfigKey]: url,
        [config.apiKeyConfigKey]: apiKey,
      });
      setStatus({ type: "success", msg: `${config.serviceName} settings saved` });
    } catch {
      setStatus({ type: "error", msg: `Failed to save ${config.serviceName} settings` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>{config.title}</legend>
      <label className={styles.field}>
        <span className={styles.label}>{config.urlLabel}</span>
        <input
          type="text"
          className={styles.input}
          placeholder={config.urlPlaceholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>API Key</span>
        <input
          type="password"
          className={styles.input}
          placeholder="Enter API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={() => runTest(url, apiKey)}
          disabled={testing}
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
    </fieldset>
  );
}

export default function SettingsArrs() {
  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testRadarrMutation = trpc.testRadarr.useMutation();
  const testSonarrMutation = trpc.testSonarr.useMutation();
  const testSeerrMutation = trpc.testSeerr.useMutation();

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const configData = (configQuery.data || {}) as Record<string, string>;

  const services: ServiceConfig[] = [
    {
      title: "Radarr",
      urlLabel: "Radarr URL",
      urlPlaceholder: "http://localhost:7878",
      urlConfigKey: "global_radarr_url",
      apiKeyConfigKey: "global_radarr_api_key",
      testMutation: testRadarrMutation,
      formatSuccess: (r) => `Connected to "${r.instanceName}"`,
      serviceName: "Radarr",
    },
    {
      title: "Sonarr",
      urlLabel: "Sonarr URL",
      urlPlaceholder: "http://localhost:8989",
      urlConfigKey: "global_sonarr_url",
      apiKeyConfigKey: "global_sonarr_api_key",
      testMutation: testSonarrMutation,
      formatSuccess: (r) => `Connected to "${r.instanceName}"`,
      serviceName: "Sonarr",
    },
    {
      title: "Jellyseerr / Overseerr",
      urlLabel: "Seerr URL",
      urlPlaceholder: "http://localhost:5055",
      urlConfigKey: "global_seerr_url",
      apiKeyConfigKey: "global_seerr_api_key",
      testMutation: testSeerrMutation,
      formatSuccess: (r) => `Connected — ${r.total} total requests`,
      serviceName: "Seerr",
    },
  ];

  return (
    <div className={styles.form}>
      {services.map((svc) => (
        <ServiceConfigFieldset
          key={svc.urlConfigKey}
          config={svc}
          configData={configData}
          saveConfigMutation={saveConfigMutation}
          utils={utils}
        />
      ))}
    </div>
  );
}
