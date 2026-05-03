import { useState, useEffect, useMemo } from "react";
import { trpc } from "../trpc";
import { useToast } from "../Toast";
import UnsavedBanner from "../UnsavedBanner";
import useUnsavedChanges from "../useUnsavedChanges";
import styles from "./Settings.module.css";

export default function SettingsAi() {
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [savingAi, setSavingAi] = useState(false);

  const { addToast } = useToast();

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setAnthropicApiKey(configQuery.data.global_anthropic_api_key || "");
    }
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return anthropicApiKey !== (configQuery.data.global_anthropic_api_key || "");
  }, [anthropicApiKey, configQuery.data]);

  useUnsavedChanges(isDirty);

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_anthropic_api_key: anthropicApiKey,
      });
      addToast("AI settings saved", "success");
    } catch {
      addToast("Failed to save AI settings", "error");
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveAi} disabled={savingAi}>
            {savingAi ? "Saving..." : "Save"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </fieldset>
    </div>
  );
}
