import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";

interface Props {
  cfg: Record<string, unknown>;
  /** True once `health.status` reports Plex configured. */
  connected: boolean;
}

/**
 * The one card that has to work before anything else does, so it gets the
 * whole width and both halves of the job: credentials, then which libraries
 * Tinkerbell is allowed to touch.
 *
 * Keeps `SettingsPlex`'s stricter rule — the connection test must pass before
 * the URL and token are stored. Every other integration saves regardless,
 * because a Radarr that is briefly down shouldn't block entering its key; Plex
 * is different because a wrong token here means every later step in this
 * wizard silently has nothing to work with.
 */
export default function PlexCard({ cfg, connected }: Props) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const saveConfig = trpc.config.save.useMutation();
  const testPlex = trpc.testPlex.useMutation();
  const refreshSections = trpc.refreshSections.useMutation();

  const storedUrl = (cfg.global_plex_url as string) ?? "";
  const storedToken = (cfg.global_plex_token as string) ?? "";
  const storedLibraries = (cfg.global_plex_libraries as string[]) ?? [];

  const [url, setUrl] = useState(storedUrl);
  const [token, setToken] = useState(storedToken);
  const [libraries, setLibraries] = useState<string[]>(storedLibraries);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingLibs, setSavingLibs] = useState(false);
  const [touchedLibs, setTouchedLibs] = useState(false);

  useEffect(() => {
    setUrl(storedUrl);
    setToken(storedToken);
  }, [storedUrl, storedToken]);

  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    enabled: Boolean(storedUrl && storedToken),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const sections = sectionsQuery.data;

  /**
   * Everything, preselected — the recommended default. A connection with no
   * libraries chosen is a connection that does nothing, and "all of them" is
   * what a new admin means. Only until they touch the list, after which their
   * choice stands.
   */
  useEffect(() => {
    if (touchedLibs || !sections) return;
    if (storedLibraries.length > 0) {
      setLibraries(storedLibraries);
      return;
    }
    setLibraries(sections.map((s) => s.title));
  }, [sections, storedLibraries, touchedLibs]);

  async function runTest(): Promise<boolean> {
    if (!url || !token) {
      addToast("Both URL and token are required", "error");
      return false;
    }
    setTesting(true);
    try {
      const result = await testPlex.mutateAsync({ plex_url: url, plex_token: token });
      addToast(`Connected to "${result.serverName}"`, "success");
      return true;
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
      return false;
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!(await runTest())) {
        addToast("Plex connection failed — settings not saved", "error");
        return;
      }
      await saveConfig.mutateAsync({ global_plex_url: url, global_plex_token: token });
      await utils.config.get.invalidate();
      await utils.onboarding.status.invalidate();
      utils.plexSections.invalidate();
      addToast("Plex connected", "success");
    } catch (err) {
      addToast(`Couldn't save Plex settings: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
      utils.health.status.invalidate();
    }
  }

  async function handleSaveLibraries() {
    setSavingLibs(true);
    try {
      await saveConfig.mutateAsync({ global_plex_libraries: libraries });
      await utils.config.get.invalidate();
      addToast("Libraries saved", "success");
    } catch (err) {
      addToast(`Couldn't save libraries: ${(err as Error).message}`, "error");
    } finally {
      setSavingLibs(false);
    }
  }

  function toggle(title: string) {
    setTouchedLibs(true);
    setLibraries((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  }

  return (
    <div className={`${styles.tile} ${styles.tilePrimary}`}>
      <div className={styles.tileHeadStatic}>
        <span className={styles.tileTitle}>
          {connected && <span className={styles.tileDot} aria-hidden="true" />}
          Plex
        </span>
        <span className={styles.tileState}>{connected ? "Connected" : "Required"}</span>
      </div>
      <p className={styles.tileBlurb}>
        Your Plex server is where Tinkerbell reads your library from and writes collections back to. Everything else on
        this page is optional.
      </p>

      <div className={styles.tileBody}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Plex URL</span>
          <input
            className={controls.input}
            type="text"
            placeholder="http://localhost:32400"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Plex Token</span>
          <input
            className={controls.input}
            type="password"
            placeholder="Enter token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className={styles.fieldHint}>
            Find yours by opening any item in Plex, choosing Get Info, then View XML — the token is the{" "}
            <code>X-Plex-Token</code> at the end of the URL.
          </span>
        </label>
        <div className={styles.tileActions}>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
            onClick={handleSave}
            disabled={saving || testing}
          >
            {saving ? "Connecting…" : "Save and connect"}
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            onClick={runTest}
            disabled={saving || testing}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      </div>

      {connected && (
        <div className={styles.tileBody}>
          <span className={styles.fieldLabel}>Libraries</span>
          {sectionsQuery.isLoading ? (
            <p className={styles.fieldHint}>Loading libraries…</p>
          ) : !sections || sections.length === 0 ? (
            <p className={styles.fieldHint}>No libraries found. Check the connection above.</p>
          ) : (
            <>
              <p className={styles.fieldHint}>
                Which libraries Tinkerbell may read and write. All of them to start with — narrow it down if you'd
                rather it left some alone.
              </p>
              <div className={styles.libraryList}>
                {sections.map((s) => (
                  <label key={s.key} className={styles.libraryItem}>
                    <input
                      type="checkbox"
                      className={controls.checkbox}
                      checked={libraries.includes(s.title)}
                      onChange={() => toggle(s.title)}
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
              <div className={styles.tileActions}>
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
                  onClick={handleSaveLibraries}
                  disabled={savingLibs}
                >
                  {savingLibs ? "Saving…" : "Save libraries"}
                </button>
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                  onClick={async () => {
                    await refreshSections.mutateAsync();
                    utils.plexSections.invalidate();
                  }}
                  disabled={refreshSections.isPending}
                >
                  {refreshSections.isPending ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
