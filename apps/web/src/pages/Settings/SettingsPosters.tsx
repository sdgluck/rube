import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ToggleSwitch from "#components/ToggleSwitch";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

const PERSON_STYLES = [
  { value: "bw", label: "Black & White (default)" },
  { value: "rainier", label: "Rainier" },
  { value: "signature", label: "Signature" },
  { value: "diiivoy", label: "Diiivoy" },
  { value: "diiivoycolor", label: "Diiivoy Color" },
] as const;

type PersonStyle = (typeof PERSON_STYLES)[number]["value"];

const PREVIEW_NAMES = ["Tom Hanks", "Greta Gerwig", "Denzel Washington"] as const;

export default function SettingsPosters() {
  const [enabled, setEnabled] = useState(false);
  const [personStyle, setPersonStyle] = useState<PersonStyle>("bw");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const clearMutation = trpc.posters.clearCache.useMutation();

  const previewName = PREVIEW_NAMES[0];
  const preview = trpc.posters.preview.useQuery(
    { provider: "kometa", kind: "actor", name: previewName, style: personStyle },
    { refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (configQuery.data) {
      setEnabled(configQuery.data.posters_kometa_enabled ?? false);
      setPersonStyle(configQuery.data.posters_kometa_person_style ?? "bw");
    }
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      enabled !== (configQuery.data.posters_kometa_enabled ?? false) ||
      personStyle !== (configQuery.data.posters_kometa_person_style ?? "bw")
    );
  }, [enabled, personStyle, configQuery.data]);

  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        posters_kometa_enabled: enabled,
        posters_kometa_person_style: personStyle,
      });
      addToast("Poster settings saved", "success");
      await utils.config.get.invalidate();
    } catch {
      addToast("Failed to save poster settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearMutation.mutateAsync();
      addToast("Poster cache cleared", "success");
      await utils.posters.preview.invalidate();
    } catch {
      addToast("Failed to clear poster cache", "error");
    } finally {
      setClearing(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <SettingsPageHeader title="Posters" />
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Kometa default posters">
        <p className={styles.hint}>
          Auto-apply curated posters from the{" "}
          <a href="https://github.com/Kometa-Team/Default-Images" target="_blank" rel="noopener noreferrer">
            Kometa default-images
          </a>{" "}
          set when generating studio, network, genre, country, actor, director, and franchise collections. Posters are
          fetched on-demand and cached locally; missing assets fall back to Plex's auto-mosaic. Imagery © respective
          rights holders, sourced via Kometa and TMDb.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Enable</span>
          <div>
            <ToggleSwitch checked={enabled} onChange={setEnabled} />
          </div>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Actor / director style</span>
          <select
            className={styles.input}
            value={personStyle}
            onChange={(e) => setPersonStyle(e.target.value as PersonStyle)}
            disabled={!enabled}
          >
            {PERSON_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Style preview ({previewName})</span>
          {preview.isLoading ? (
            <span className={styles.hint}>Loading…</span>
          ) : preview.data?.status === "ok" ? (
            <img
              src={preview.data.url}
              alt={`${previewName} — ${personStyle}`}
              style={{ width: "16rem", height: "24rem", objectFit: "cover", borderRadius: "var(--r-sm)" }}
            />
          ) : (
            <span className={styles.hint}>No preview available</span>
          )}
        </div>

        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleClearCache} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear cache"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>
    </div>
  );
}
