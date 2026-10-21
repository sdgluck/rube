import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import Banner from "#components/Banner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

const MAX_HEIGHTS = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p (recommended)" },
  { value: 1440, label: "1440p" },
  { value: 2160, label: "2160p / 4K" },
] as const;

const DEFAULTS = { path: "/prerolls", maxHeight: 1080 };

export default function SettingsPrerolls() {
  const [plexPath, setPlexPath] = useState(DEFAULTS.path);
  const [maxHeight, setMaxHeight] = useState<number>(DEFAULTS.maxHeight);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Null until the user touches the checkbox: before that it follows whether
  // the saved path already equals Rube's own, which is the common setup.
  const [samePathChoice, setSamePathChoice] = useState<boolean | null>(null);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const envQuery = trpc.prerolls.environment.useQuery();
  const plexPass = trpc.prerolls.plexStatus.useQuery(undefined, { refetchOnWindowFocus: false }).data?.plexPass;
  const saveMutation = trpc.config.save.useMutation();
  const verifyMutation = trpc.prerolls.verifyPlexPath.useMutation();

  useEffect(() => {
    if (!configQuery.data) return;
    setPlexPath(configQuery.data.prerolls_plex_path ?? DEFAULTS.path);
    setMaxHeight(configQuery.data.prerolls_max_height ?? DEFAULTS.maxHeight);
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      plexPath !== (configQuery.data.prerolls_plex_path ?? DEFAULTS.path) ||
      maxHeight !== (configQuery.data.prerolls_max_height ?? DEFAULTS.maxHeight)
    );
  }, [plexPath, maxHeight, configQuery.data]);

  useUnsavedChanges(isDirty);

  async function handleSave() {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({ prerolls_plex_path: plexPath.trim(), prerolls_max_height: maxHeight });
      addToast("Preroll settings saved", "success");
      await Promise.all([
        utils.config.get.invalidate(),
        utils.prerolls.environment.invalidate(),
        utils.prerolls.plexStatus.invalidate(),
      ]);
    } catch {
      addToast("Failed to save preroll settings", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const result = await verifyMutation.mutateAsync();
      if (result.writable) {
        addToast("Plex accepted a write to the pre-roll setting", "success");
      } else {
        addToast("Plex didn't store the test value — the setting may be unavailable on this server", "error");
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't reach Plex", "error");
    } finally {
      setVerifying(false);
    }
  }

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const env = envQuery.data;
  const samePath = env ? (samePathChoice ?? plexPath === env.dir) : false;

  return (
    <div className={styles.form}>
      <SettingsPageHeader
        title="Prerolls"
        meta={
          plexPass == null ? undefined : (
            <span
              className={`${styles.status} ${plexPass ? styles.statusOk : styles.statusWarn}`}
              title={plexPass ? undefined : "Plex only plays pre-rolls with an active Plex Pass"}
            >
              <span className={styles.statusDot} aria-hidden="true" />
              Plex Pass {plexPass ? "active" : "not active"}
            </span>
          )
        }
      />

      {env && env.ffmpeg === null && (
        <Banner variant="error">
          ffmpeg isn't installed or isn't on PATH, so uploaded prerolls can't be processed. The Docker image ships with
          it; on a bare install, add it with your package manager (<code>brew install ffmpeg</code>,{" "}
          <code>apt install ffmpeg</code>) and restart Rube.
        </Banner>
      )}

      {env && !env.dirWritable && (
        <Banner variant="error">
          Rube can't write to <code>{env.dir}</code>. Check the volume mount and its ownership.
        </Banner>
      )}

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Storage">
        <p className={styles.hint}>Mount one directory into both Rube and Plex.</p>

        <div className={styles.field}>
          <span className={styles.label}>Rube's directory</span>
          <code className={styles.hint}>{env?.dir ?? "—"}</code>
          <p className={styles.hint}>
            Set by <code>PREROLLS_DIR</code>.
          </p>
        </div>

        {env && (
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={samePath}
              onChange={(e) => {
                setSamePathChoice(e.target.checked);
                if (e.target.checked) setPlexPath(env.dir);
              }}
            />
            <span className={styles.label}>Plex sees it at the same path</span>
          </label>
        )}

        {!samePath && (
          <label className={styles.field}>
            <span className={styles.label}>The same directory, as Plex sees it</span>
            <input
              className={styles.input}
              value={plexPath}
              placeholder="/data/prerolls"
              onChange={(e) => setPlexPath(e.target.value)}
            />
            <p className={styles.hint}>A wrong path is the usual reason prerolls don't play.</p>
          </label>
        )}

        <div className={styles.buttons}>
          <button type="button" className={styles.buttonSecondary} onClick={handleVerify} disabled={verifying}>
            {verifying ? "Checking…" : "Test Plex connection"}
          </button>
        </div>
        <p className={styles.hint}>Checks Plex accepts the setting, not that the path exists.</p>
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Transcoding">
        <p className={styles.hint}>Uploads Plex can't direct play are converted to H.264/AAC MP4.</p>

        <label className={styles.field}>
          <span className={styles.label}>Maximum resolution</span>
          <select className={styles.input} value={maxHeight} onChange={(e) => setMaxHeight(Number(e.target.value))}>
            {MAX_HEIGHTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className={styles.hint}>Taller sources are downscaled. Shorter ones are never upscaled.</p>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>ffmpeg</span>
          <span className={styles.hint}>{env ? (env.ffmpeg ?? "Not found") : "Checking…"}</span>
        </div>
      </CardSection>

      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <UnsavedBanner visible={isDirty} />
      </div>
    </div>
  );
}
