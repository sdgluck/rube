import { useState, useEffect, useMemo } from "react";
import { PROVIDERS, getProviderMeta, type LlmConfig, type LlmProvider } from "@tinkerbell/llm/meta";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

const DEFAULT_LLM: LlmConfig = {
  provider: "anthropic",
  model: getProviderMeta("anthropic").defaultModel,
};

export default function SettingsAi() {
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM);
  const [savedLlm, setSavedLlm] = useState<LlmConfig>(DEFAULT_LLM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const { addToast } = useToast();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfigMutation = trpc.config.save.useMutation();
  const testLlmMutation = trpc.testLlm.useMutation();

  useEffect(() => {
    if (!configQuery.data) return;
    let initial: LlmConfig;
    if (configQuery.data.global_llm) {
      initial = configQuery.data.global_llm;
    } else if (configQuery.data.global_anthropic_api_key) {
      initial = { ...DEFAULT_LLM, apiKey: configQuery.data.global_anthropic_api_key };
    } else {
      initial = DEFAULT_LLM;
    }
    setLlm(initial);
    setSavedLlm(initial);
  }, [configQuery.data]);

  const meta = getProviderMeta(llm.provider);

  const isDirty = useMemo(() => JSON.stringify(llm) !== JSON.stringify(savedLlm), [llm, savedLlm]);
  useUnsavedChanges(isDirty);

  function updateProvider(provider: LlmProvider) {
    const newMeta = getProviderMeta(provider);
    setLlm({
      provider,
      model: newMeta.defaultModel,
      apiKey: newMeta.fields.apiKey === "hidden" ? undefined : "",
      baseUrl: newMeta.fields.baseUrl === "hidden" ? undefined : (newMeta.defaultBaseUrl ?? ""),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({ global_llm: normalize(llm) });
      setSavedLlm(llm);
      addToast("AI settings saved", "success");
      configQuery.refetch();
    } catch {
      addToast("Failed to save AI settings", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await testLlmMutation.mutateAsync(normalize(llm));
      addToast(`Connected — ${result.provider}:${result.model}`, "success");
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
    } finally {
      setTesting(false);
    }
  }

  if (configQuery.isLoading) return <FormSkeleton rows={4} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <SettingsPageHeader title="AI" />
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="LLM provider">
        <p className={styles.hint}>
          Tinkerbell sends prompts to whichever LLM you configure here. Switch providers any time — your existing rules
          will use the new one on the next run.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Provider</span>
          <select
            className={styles.input}
            value={llm.provider}
            onChange={(e) => updateProvider(e.target.value as LlmProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {meta.description && <p className={styles.hint}>{meta.description}</p>}

        {meta.fields.apiKey !== "hidden" && (
          <label className={styles.field}>
            <span className={styles.label}>API key {meta.fields.apiKey === "optional" && <em>(optional)</em>}</span>
            <input
              type="password"
              className={styles.input}
              placeholder={meta.keyHint || ""}
              autoComplete="off"
              value={llm.apiKey ?? ""}
              onChange={(e) => setLlm((s) => ({ ...s, apiKey: e.target.value }))}
            />
            {meta.signupUrl && (
              <span className={styles.hint}>
                Get one at{" "}
                <a href={meta.signupUrl} target="_blank" rel="noopener noreferrer">
                  {new URL(meta.signupUrl).hostname}
                </a>
              </span>
            )}
          </label>
        )}

        {meta.fields.baseUrl !== "hidden" && (
          <label className={styles.field}>
            <span className={styles.label}>Base URL {meta.fields.baseUrl === "optional" && <em>(optional)</em>}</span>
            <input
              type="text"
              className={styles.input}
              placeholder={meta.defaultBaseUrl || "https://example.com/v1"}
              value={llm.baseUrl ?? ""}
              onChange={(e) => setLlm((s) => ({ ...s, baseUrl: e.target.value }))}
            />
          </label>
        )}

        <label className={styles.field}>
          <span className={styles.label}>Model</span>
          <input
            type="text"
            className={styles.input}
            list={`llm-models-${llm.provider}`}
            value={llm.model}
            onChange={(e) => setLlm((s) => ({ ...s, model: e.target.value }))}
            placeholder={meta.defaultModel}
          />
          {meta.modelPresets.length > 0 && (
            <datalist id={`llm-models-${llm.provider}`}>
              {meta.modelPresets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          )}
        </label>

        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.button} onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>
    </div>
  );
}

function normalize(cfg: LlmConfig): LlmConfig {
  const out: LlmConfig = { provider: cfg.provider, model: cfg.model.trim() };
  if (cfg.apiKey && cfg.apiKey.trim().length > 0) out.apiKey = cfg.apiKey.trim();
  if (cfg.baseUrl && cfg.baseUrl.trim().length > 0) out.baseUrl = cfg.baseUrl.trim();
  if (cfg.maxTokens) out.maxTokens = cfg.maxTokens;
  if (cfg.temperature !== undefined) out.temperature = cfg.temperature;
  return out;
}
