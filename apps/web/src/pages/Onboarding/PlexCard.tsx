import { useEffect, useRef, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";
import { isNative } from "@tinkerbell/native-client";

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_POLL_ATTEMPTS = 90; // three minutes, then give up and let them retry

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
 *
 * The token comes from "Sign in with Plex" by default. Plex's own page opens
 * in a popup rather than taking over the tab, as the admin sign-in does,
 * because this card holds a half-typed URL that a full-page round trip would
 * lose. The server keeps the PIN and stores the token; this side only polls.
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
  const [pasting, setPasting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const signInStart = trpc.onboarding.plexSignIn.useMutation();
  const signInPoll = trpc.onboarding.plexSignInPoll.useMutation();
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

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

  async function handleSignIn() {
    // The popup handshake is a browser's: in the app the window would open
    // outside it and the handshake cookie would never come back. Setting up a
    // server is a once-ever job done at a desk, so the app doesn't replicate it.
    if (isNative()) {
      addToast("Sign in with Plex from Tinkerbell in a web browser, or enter the server URL and token below", "info");
      return;
    }
    // Opened before the request, while the click still counts as a user
    // gesture — a popup opened after an await is what blockers refuse.
    const popup = window.open("", "plex-sign-in", "width=800,height=720");
    if (!popup) {
      addToast("Allow pop-ups for this site to sign in with Plex", "error");
      return;
    }
    setSigningIn(true);
    try {
      const { authUrl } = await signInStart.mutateAsync();
      popup.location.href = authUrl;
    } catch (err) {
      popup.close();
      addToast(`Couldn't start Plex sign-in: ${(err as Error).message}`, "error");
      setSigningIn(false);
      return;
    }

    let attempts = 0;
    const finish = () => {
      setSigningIn(false);
      popup.close();
    };
    const tick = async () => {
      attempts++;
      try {
        const res = await signInPoll.mutateAsync();
        if (res.status === "ok") {
          finish();
          addToast(`Signed in as ${res.username}`, "success");
          await utils.config.get.invalidate();
          return;
        }
        if (res.status === "expired") {
          finish();
          addToast("That sign-in expired — try again", "error");
          return;
        }
      } catch (err) {
        finish();
        addToast(`Plex sign-in failed: ${(err as Error).message}`, "error");
        return;
      }
      // Still pending with the window gone: they closed it without approving.
      if (popup.closed || attempts >= SIGN_IN_POLL_ATTEMPTS) {
        finish();
        return;
      }
      pollTimer.current = setTimeout(tick, SIGN_IN_POLL_MS);
    };
    pollTimer.current = setTimeout(tick, SIGN_IN_POLL_MS);
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
      <p className={styles.tileBlurb}>Where Tinkerbell reads your library and writes collections.</p>

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
        {pasting ? (
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
              In Plex: Get Info › View XML › <code>X-Plex-Token</code> in the URL.
            </span>
          </label>
        ) : (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Plex account</span>
            <div className={styles.tileActions}>
              <button
                type="button"
                className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                onClick={handleSignIn}
                disabled={signingIn}
              >
                {signingIn ? "Waiting for Plex…" : storedToken ? "Sign in again" : "Sign in with Plex"}
              </button>
              <button
                type="button"
                className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                onClick={() => setPasting(true)}
              >
                Paste a token instead
              </button>
            </div>
            {storedToken && <span className={styles.fieldHint}>Token saved.</span>}
          </div>
        )}
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
              <p className={styles.fieldHint}>Tinkerbell leaves unticked libraries alone.</p>
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
