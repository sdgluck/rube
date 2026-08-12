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

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const envQuery = trpc.prerolls.environment.useQuery();
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

  return (
    <div className={styles.form}>
      <SettingsPageHeader
        title="Prerolls"
        description="Where preroll videos are stored, and how Plex is told to find them."
      />

      {env && env.ffmpeg === null && (
        <Banner variant="error">
          ffmpeg isn't installed or isn't on PATH, so uploaded prerolls can't be processed. The Docker image ships with
          it; on a bare install, add it with your package manager (<code>brew install ffmpeg</code>,{" "}
          <code>apt install ffmpeg</code>) and restart Tinkerbell.
        </Banner>
      )}

      {env && !env.dirWritable && (
        <Banner variant="error">
          Tinkerbell can't write to <code>{env.dir}</code>. Check the volume mount and its ownership.
        </Banner>
      )}

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Storage">
        <p className={styles.hint}>
          Prerolls are files, and Plex plays them off its own disk — so the same directory has to be visible to both
          programs. Mount one directory into both containers, then tell Tinkerbell what Plex calls it.
        </p>

        <div className={styles.field}>
          <span className={styles.label}>Tinkerbell's directory</span>
          <code className={styles.hint}>{env?.dir ?? "—"}</code>
          <p className={styles.hint}>
            Set with the <code>PREROLLS_DIR</code> environment variable. Defaults to a <code>prerolls</code> folder
            inside the data directory.
          </p>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>The same directory, as Plex sees it</span>
          <input
            className={styles.input}
            value={plexPath}
            placeholder="/prerolls"
            onChange={(e) => setPlexPath(e.target.value)}
          />
          <p className={styles.hint}>
            If both containers mount the directory at the same path, this matches the line above. If Plex mounts it
            somewhere else — say <code>/data/prerolls</code> — put that here instead. Getting this wrong is the usual
            reason prerolls don't play: Plex accepts the setting and then finds nothing at the path.
          </p>
        </label>

        <div className={styles.buttons}>
          <button type="button" className={styles.buttonSecondary} onClick={handleVerify} disabled={verifying}>
            {verifying ? "Checking…" : "Test Plex connection"}
          </button>
        </div>
        <p className={styles.hint}>
          This writes a throwaway value to Plex's pre-roll setting and reads it back, then restores what was there. It
          proves Plex accepts the setting — it can't prove the path resolves on Plex's filesystem, because nothing over
          the API can.
        </p>
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Transcoding">
        <p className={styles.hint}>
          Uploads are inspected and left alone when Plex would already direct play them. Anything else is converted to
          H.264/AAC in an MP4 — otherwise a ten-second clip can occupy a transcode session and stutter.
        </p>

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

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Requirements">
        <p className={styles.hint}>
          Pre-rolls are a Plex Pass feature. Without an active subscription Plex will store the setting but never play
          anything — if everything here looks right and nothing plays, that's the first thing to check.
        </p>
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
