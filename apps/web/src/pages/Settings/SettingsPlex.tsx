import { useState, useEffect, useMemo } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

export default function SettingsPlex() {
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [savingPlex, setSavingPlex] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
  const [savingLibs, setSavingLibs] = useState(false);

  const { addToast } = useToast();

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    enabled: Boolean(plexUrl && plexToken),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [refreshing, setRefreshing] = useState(false);

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testPlexMutation = trpc.testPlex.useMutation();
  const refreshSectionsMutation = trpc.refreshSections.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setPlexUrl(configQuery.data.global_plex_url || "");
      setPlexToken(configQuery.data.global_plex_token || "");
      if (configQuery.data.global_plex_libraries) {
        setSelectedLibraries(configQuery.data.global_plex_libraries);
      }
    }
  }, [configQuery.data]);

  const isDirtyPlex = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      plexUrl !== (configQuery.data.global_plex_url || "") || plexToken !== (configQuery.data.global_plex_token || "")
    );
  }, [plexUrl, plexToken, configQuery.data]);

  const isDirtyLibs = useMemo(() => {
    if (!configQuery.data) return false;
    const initial = configQuery.data.global_plex_libraries || [];
    if (initial.length !== selectedLibraries.length) return true;
    return !initial.every((l: string) => selectedLibraries.includes(l));
  }, [selectedLibraries, configQuery.data]);

  useUnsavedChanges(isDirtyPlex || isDirtyLibs);

  const runPlexTest = async (url: string, token: string): Promise<boolean> => {
    if (!url || !token) {
      addToast("Both URL and token are required", "error");
      return false;
    }
    setTesting(true);
    try {
      const result = await testPlexMutation.mutateAsync({ plex_url: url, plex_token: token });
      addToast(`Connected to "${result.serverName}"`, "success");
      return true;
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
      return false;
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  };

  const toggleLibrary = (title: string) => {
    setSelectedLibraries((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  };

  const handleSaveLibraries = async () => {
    setSavingLibs(true);
    try {
      await saveConfigMutation.mutateAsync({ global_plex_libraries: selectedLibraries });
      addToast("Library selections saved", "success");
    } catch {
      addToast("Failed to save library selections", "error");
    } finally {
      setSavingLibs(false);
    }
  };

  const handleTest = () => {
    runPlexTest(plexUrl, plexToken);
  };

  const handleRefreshSections = async () => {
    setRefreshing(true);
    try {
      await refreshSectionsMutation.mutateAsync();
      utils.plexSections.invalidate();
    } catch {
      // Refresh failed — sectionsQuery will show stale data
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePlex = async () => {
    setSavingPlex(true);
    try {
      const ok = await runPlexTest(plexUrl, plexToken);
      if (!ok) {
        addToast("Plex connection failed — settings not saved", "error");
        setSavingPlex(false);
        return;
      }
      await saveConfigMutation.mutateAsync({
        global_plex_url: plexUrl,
        global_plex_token: plexToken,
      });
      addToast("Plex settings saved", "success");
    } catch {
      addToast("Failed to save Plex settings", "error");
    } finally {
      setSavingPlex(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={6} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const sections = sectionsQuery.data;

  return (
    <div className={styles.form}>
      <SettingsPageHeader title="Plex" />
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Connection">
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSavePlex} disabled={savingPlex}>
            {savingPlex ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
          <UnsavedBanner visible={isDirtyPlex} />
        </div>
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Plex Libraries">
        {!plexUrl || !plexToken ? (
          <p className={styles.hint}>Configure Plex URL and token above first.</p>
        ) : sectionsQuery.isLoading ? (
          <p className={styles.hint}>Loading libraries…</p>
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
            <div className={styles.buttons}>
              <button type="button" className={styles.button} onClick={handleSaveLibraries} disabled={savingLibs}>
                {savingLibs ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={handleRefreshSections}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <UnsavedBanner visible={isDirtyLibs} />
            </div>
          </>
        )}
      </CardSection>
    </div>
  );
}
