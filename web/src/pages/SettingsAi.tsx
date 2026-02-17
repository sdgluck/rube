import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsAi() {
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [omdbApiKey, setOmdbApiKey] = useState("");
  const [aiStatus, setAiStatus] = useState<Status | null>(null);
  const [omdbStatus, setOmdbStatus] = useState<Status | null>(null);
  const [savingAi, setSavingAi] = useState(false);
  const [savingOmdb, setSavingOmdb] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setAnthropicApiKey(configQuery.data.global_anthropic_api_key || "");
      setOmdbApiKey(configQuery.data.global_omdb_api_key || "");
    }
  }, [configQuery.data]);

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

  const handleSaveOmdb = async () => {
    setOmdbStatus(null);
    setSavingOmdb(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_omdb_api_key: omdbApiKey,
      });
      setOmdbStatus({ type: "success", msg: "OMDB settings saved" });
    } catch {
      setOmdbStatus({ type: "error", msg: "Failed to save OMDB settings" });
    } finally {
      setSavingOmdb(false);
    }
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
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
        <legend className={styles.groupTitle}>OMDB</legend>
        <label className={styles.field}>
          <span className={styles.label}>OMDB API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter OMDB API key"
            value={omdbApiKey}
            onChange={(e) => setOmdbApiKey(e.target.value)}
          />
          <span className={styles.hint}>Free tier: 1,000 requests/day. Get a key at omdbapi.com</span>
        </label>
        {omdbStatus && <div className={`${styles.toast} ${styles[omdbStatus.type]}`}>{omdbStatus.msg}</div>}
        <button type="button" className={styles.button} onClick={handleSaveOmdb} disabled={savingOmdb}>
          {savingOmdb ? "Saving..." : "Save"}
        </button>
      </fieldset>
    </div>
  );
}
