import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function Settings() {
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [plexStatus, setPlexStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingPlex, setSavingPlex] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
  const [libStatus, setLibStatus] = useState<Status | null>(null);
  const [savingLibs, setSavingLibs] = useState(false);
  const [aiStatus, setAiStatus] = useState<Status | null>(null);
  const [savingAi, setSavingAi] = useState(false);
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

  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    enabled: Boolean(plexUrl && plexToken),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();
  const testPlexMutation = trpc.testPlex.useMutation();
  const testRadarrMutation = trpc.testRadarr.useMutation();
  const testSonarrMutation = trpc.testSonarr.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setPlexUrl(configQuery.data.global_plex_url || "");
      setPlexToken(configQuery.data.global_plex_token || "");
      setAnthropicApiKey(configQuery.data.global_anthropic_api_key || "");
      if (configQuery.data.global_plex_libraries) {
        setSelectedLibraries(configQuery.data.global_plex_libraries);
      }
      setRadarrUrl(configQuery.data.global_radarr_url || "");
      setRadarrApiKey(configQuery.data.global_radarr_api_key || "");
      setSonarrUrl(configQuery.data.global_sonarr_url || "");
      setSonarrApiKey(configQuery.data.global_sonarr_api_key || "");
    }
  }, [configQuery.data]);

  const runPlexTest = async (url: string, token: string): Promise<boolean> => {
    setPlexStatus(null);
    if (!url || !token) {
      setPlexStatus({ type: "error", msg: "Both URL and token are required" });
      return false;
    }
    setTesting(true);
    try {
      const result = await testPlexMutation.mutateAsync({ plex_url: url, plex_token: token });
      if (result.ok) {
        setPlexStatus({
          type: "success",
          msg: `Connected to "${result.serverName}"`,
        });
        return true;
      }
      throw "nope";
    } catch {
      setPlexStatus({ type: "error", msg: "Connection test failed" });
      return false;
    } finally {
      setTesting(false);
    }
  };

  const toggleLibrary = (title: string) => {
    setSelectedLibraries((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  };

  const handleSaveLibraries = async () => {
    setLibStatus(null);
    setSavingLibs(true);
    try {
      await saveConfigMutation.mutateAsync({ global_plex_libraries: selectedLibraries });
      setLibStatus({ type: "success", msg: "Library selections saved" });
    } catch {
      setLibStatus({ type: "error", msg: "Failed to save library selections" });
    } finally {
      setSavingLibs(false);
    }
  };

  const handleTest = () => {
    runPlexTest(plexUrl, plexToken);
  };

  const handleSavePlex = async () => {
    setPlexStatus(null);
    setSavingPlex(true);
    try {
      const ok = await runPlexTest(plexUrl, plexToken);
      if (!ok) {
        setPlexStatus({
          type: "error",
          msg: "Plex connection failed — settings not saved",
        });
        setSavingPlex(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        global_plex_url: plexUrl,
        global_plex_token: plexToken,
      });
      setPlexStatus({ type: "success", msg: "Plex settings saved" });
    } catch {
      setPlexStatus({ type: "error", msg: "Failed to save Plex settings" });
    } finally {
      setSavingPlex(false);
    }
  };

  const handleSaveAi = async () => {
    setAiStatus(null);
    setSavingAi(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_anthropic_api_key: anthropicApiKey,
      });
      setAiStatus({ type: "success", msg: "AI settings saved" });
    } catch {
      setAiStatus({ type: "error", msg: "Failed to save AI settings" });
    } finally {
      setSavingAi(false);
    }
  };

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

  const sections = sectionsQuery.data;

  return (
    <div>
      <h2 className={styles.heading}>Settings</h2>
      <div className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Plex</legend>
          <label className={styles.field}>
            <span className={styles.label}>Plex URL</span>
            <input
              type="text"
              className={styles.input}
              placeholder="http://localhost:32400"
              value={plexUrl}
              onChange={(e) => setPlexUrl(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Plex Token</span>
            <input
              type="password"
              className={styles.input}
              placeholder="Enter token"
              value={plexToken}
              onChange={(e) => setPlexToken(e.target.value)}
            />
          </label>
          {plexStatus && <div className={`${styles.toast} ${styles[plexStatus.type]}`}>{plexStatus.msg}</div>}
          <div className={styles.buttons}>
            <button type="button" className={styles.button} onClick={handleSavePlex} disabled={savingPlex}>
              {savingPlex ? "Saving..." : "Save"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Plex Libraries</legend>
          {!plexUrl || !plexToken ? (
            <p className={styles.hint}>Configure Plex URL and token above first.</p>
          ) : sectionsQuery.isLoading ? (
            <p className={styles.hint}>Loading libraries...</p>
          ) : !sections || sections.length === 0 ? (
            <p className={styles.hint}>No libraries found. Check your Plex connection.</p>
          ) : (
            <>
              <div className={styles.libraryList}>
                {sections.map((s) => (
                  <label key={s.key} className={styles.libraryItem}>
                    <input
                      type="checkbox"
                      className={styles.toggle}
                      checked={selectedLibraries.includes(s.title)}
                      onChange={() => toggleLibrary(s.title)}
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
              {libStatus && <div className={`${styles.toast} ${styles[libStatus.type]}`}>{libStatus.msg}</div>}
              <button type="button" className={styles.button} onClick={handleSaveLibraries} disabled={savingLibs}>
                {savingLibs ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>AI</legend>
          <label className={styles.field}>
            <span className={styles.label}>AI Token</span>
            <input
              type="password"
              className={styles.input}
              placeholder="Enter API key"
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
            />
          </label>
          {aiStatus && <div className={`${styles.toast} ${styles[aiStatus.type]}`}>{aiStatus.msg}</div>}
          <button type="button" className={styles.button} onClick={handleSaveAi} disabled={savingAi}>
            {savingAi ? "Saving..." : "Save"}
          </button>
        </fieldset>

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
    </div>
  );
}
