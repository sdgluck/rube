import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import styles from "#pages/Settings/Settings.module.css";
import type { DatabaseServiceConfig } from "./databases.config";

interface Props {
  config: DatabaseServiceConfig;
  runTest: (input: { api_key: string }) => Promise<string>;
}

export default function DatabaseServiceForm({ config, runTest }: Props) {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const { addToast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const configData = (configQuery.data || {}) as Record<string, string>;
  const initialApiKey = configData[config.apiKeyConfigKey] || "";

  useEffect(() => {
    setApiKey(initialApiKey);
  }, [initialApiKey]);

  const isDirty = useMemo(() => apiKey !== initialApiKey, [apiKey, initialApiKey]);

  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({ [config.apiKeyConfigKey]: apiKey });
      utils.config.get.invalidate();
      addToast(`${config.serviceName} settings saved`, "success");
    } catch {
      addToast(`Failed to save ${config.serviceName} settings`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey) {
      addToast("API key is required", "error");
      return;
    }
    setTesting(true);
    try {
      const message = await runTest({ api_key: apiKey });
      addToast(message, "success");
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={2} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>{config.title}</legend>
        <label className={styles.field}>
          <span className={styles.label}>{config.apiKeyLabel}</span>
          <input
            type="password"
            className={styles.input}
            placeholder={config.apiKeyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className={styles.hint}>{config.hint}</span>
        </label>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </fieldset>
    </div>
  );
}
