import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsAi() {
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [aiStatus, setAiStatus] = useState<Status | null>(null);
  const [savingAi, setSavingAi] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setAnthropicApiKey(configQuery.data.global_anthropic_api_key || "");
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
    </div>
  );
}
