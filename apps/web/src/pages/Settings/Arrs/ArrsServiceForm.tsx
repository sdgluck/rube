import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import styles from "#pages/Settings/Settings.module.css";
import type { ArrsServiceConfig } from "./arrs.config";

interface Props {
  config: ArrsServiceConfig;
  runTest: (input: { url: string; api_key: string }) => Promise<string>;
}

export default function ArrsServiceForm({ config, runTest }: Props) {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const { addToast } = useToast();

  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const configData = (configQuery.data || {}) as Record<string, string>;
  const initialUrl = configData[config.urlConfigKey] || "";
  const initialApiKey = configData[config.apiKeyConfigKey] || "";

  useEffect(() => {
    setUrl(initialUrl);
    setApiKey(initialApiKey);
  }, [initialUrl, initialApiKey]);

  const isDirty = useMemo(
    () => url !== initialUrl || apiKey !== initialApiKey,
    [url, apiKey, initialUrl, initialApiKey],
  );

  useUnsavedChanges(isDirty);

  /** Test never writes config — see the note on handleSave. */
  const handleTest = async () => {
    if (!url || !apiKey) {
      addToast("Both URL and API key are required", "error");
      return;
    }
    setTesting(true);
    try {
      addToast(await runTest({ url, api_key: apiKey }), "success");
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  /**
   * Save always saves.
   *
   * This used to run a connection test first and refuse to save when it failed,
   * which made it impossible to enter credentials for a service that happens to
   * be down — and emitted two toasts on the way. The other two service forms
   * (Databases, Notifications) saved unconditionally, so the same-looking button
   * behaved differently in three places. A failed reachability check is now a
   * warning, not a veto.
   */
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({
        [config.urlConfigKey]: url,
        [config.apiKeyConfigKey]: apiKey,
      });
      utils.config.get.invalidate();
      addToast(`${config.serviceName} settings saved`, "success");
    } catch {
      addToast(`Failed to save ${config.serviceName} settings`, "error");
    } finally {
      setSaving(false);
      utils.health.status.invalidate();
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={2} />;
  if (configQuery.error) {
    return (
      <ErrorState title="Couldn't load settings" error={configQuery.error} onRetry={() => configQuery.refetch()} />
    );
  }

  return (
    <div className={styles.form}>
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </fieldset>
    </div>
  );
}
