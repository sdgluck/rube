import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsPlex() {
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [plexStatus, setPlexStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingPlex, setSavingPlex] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
  const [libStatus, setLibStatus] = useState<Status | null>(null);
  const [savingLibs, setSavingLibs] = useState(false);

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

  useEffect(() => {
    if (configQuery.data) {
      setPlexUrl(configQuery.data.global_plex_url || "");
      setPlexToken(configQuery.data.global_plex_token || "");
      if (configQuery.data.global_plex_libraries) {
        setSelectedLibraries(configQuery.data.global_plex_libraries);
      }
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

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const sections = sectionsQuery.data;

  return (
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
    </div>
  );
}
