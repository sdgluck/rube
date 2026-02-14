import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [plexStatus, setPlexStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
  const [libStatus, setLibStatus] = useState<Status | null>(null);
  const [savingLibs, setSavingLibs] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    enabled: Boolean(values.plex_url && values.plex_token),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();
  const testPlexMutation = trpc.testPlex.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setValues(configQuery.data);
      if (configQuery.data.plex_libraries) {
        try {
          setSelectedLibraries(JSON.parse(configQuery.data.plex_libraries));
        } catch {}
      }
    }
  }, [configQuery.data]);

  const set = (key: string, value: string) => setValues({ ...values, [key]: value });

  const runPlexTest = async (url: string | undefined, token: string | undefined): Promise<boolean> => {
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
      await saveConfigMutation.mutateAsync({ plex_libraries: JSON.stringify(selectedLibraries) });
      setLibStatus({ type: "success", msg: "Library selections saved" });
    } catch {
      setLibStatus({ type: "error", msg: "Failed to save library selections" });
    } finally {
      setSavingLibs(false);
    }
  };

  const handleTest = () => {
    runPlexTest(values.plex_url, values.plex_token);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setSaving(true);
    try {
      const ok = await runPlexTest(values.plex_url, values.plex_token);
      if (!ok) {
        setStatus({
          type: "error",
          msg: "Plex connection failed — settings not saved",
        });
        setSaving(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        plex_url: values.plex_url || "",
        plex_token: values.plex_token || "",
        anthropic_api_key: values.anthropic_api_key || "",
      });
      setStatus({ type: "success", msg: "Settings saved" });
    } catch {
      setStatus({ type: "error", msg: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const sections = sectionsQuery.data;

  return (
    <div>
      <h2 className={styles.heading}>Settings</h2>
      {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Plex</legend>
          <label className={styles.field}>
            <span className={styles.label}>Plex URL</span>
            <input
              type="text"
              className={styles.input}
              placeholder="http://localhost:32400"
              value={values.plex_url || ""}
              onChange={(e) => set("plex_url", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Plex Token</span>
            <input
              type="password"
              className={styles.input}
              placeholder="Enter token"
              value={values.plex_token || ""}
              onChange={(e) => set("plex_token", e.target.value)}
            />
          </label>
          {plexStatus && <div className={`${styles.toast} ${styles[plexStatus.type]}`}>{plexStatus.msg}</div>}
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Plex Libraries</legend>
          {!values.plex_url || !values.plex_token ? (
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
                    <span className={styles.hint}>({s.type})</span>
                  </label>
                ))}
              </div>
              {libStatus && <div className={`${styles.toast} ${styles[libStatus.type]}`}>{libStatus.msg}</div>}
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={handleSaveLibraries}
                disabled={savingLibs}
              >
                {savingLibs ? "Saving..." : "Save Libraries"}
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
              value={values.anthropic_api_key || ""}
              onChange={(e) => set("anthropic_api_key", e.target.value)}
            />
          </label>
        </fieldset>

        <button type="submit" className={styles.button} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}
