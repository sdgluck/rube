import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_PRESENTATION } from "@rube/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ToggleSwitch from "#components/ToggleSwitch";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { FormSkeleton } from "#components/Skeleton";
import CollectionPosterPreview from "#components/CollectionPosterPreview";
import ColorField from "#components/ColorField";
import controls from "#/styles/controls.module.css";
import ThemeToggle from "#components/ThemeToggle";
import UiScalePicker from "#components/UiScalePicker";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

type DefaultTemplate = "gradient" | "mosaic" | "spotlight";

/**
 * A segmented choice over the one live preview below it, rather than a tile
 * per template: each preview is a server-side render, and three of them on
 * every accent change is real work for a choice the single preview already
 * shows. The description rides on the button's tooltip.
 */
const TEMPLATES: { value: DefaultTemplate; label: string; title: string }[] = [
  { value: "gradient", label: "Gradient", title: "A coloured plate with the title set large" },
  { value: "mosaic", label: "Mosaic", title: "A darkened grid of the collection's own posters" },
  { value: "spotlight", label: "Spotlight", title: "One member's poster over a blurred copy of itself" },
];

export default function SettingsAppearance() {
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState<DefaultTemplate>("gradient");
  const [accent, setAccent] = useState("");
  const [assetDir, setAssetDir] = useState("");
  const [saving, setSaving] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const startJob = trpc.jobs.start.useMutation();

  useEffect(() => {
    if (!configQuery.data) return;
    setEnabled(configQuery.data.collection_art_enabled ?? true);
    setTemplate((configQuery.data.collection_art_default_template as DefaultTemplate) ?? "gradient");
    setAccent(configQuery.data.collection_art_default_accent ?? "");
    setAssetDir(configQuery.data.global_asset_directory ?? "");
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      enabled !== (configQuery.data.collection_art_enabled ?? true) ||
      template !== ((configQuery.data.collection_art_default_template as DefaultTemplate) ?? "gradient") ||
      accent !== (configQuery.data.collection_art_default_accent ?? "") ||
      assetDir !== (configQuery.data.global_asset_directory ?? "")
    );
  }, [enabled, template, accent, assetDir, configQuery.data]);

  useUnsavedChanges(isDirty);

  const accentValid = accent === "" || /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent);
  // Blank is fine (the feature is off); anything else has to be absolute,
  // because the server resolves it with no working directory worth speaking of.
  const assetDirValid = assetDir.trim() === "" || assetDir.trim().startsWith("/");
  // Read as the artwork job would read it, while it's typed — the count is
  // what tells someone they've pointed at the right folder.
  const assetProbe = useDebouncedValue(assetDir.trim(), 400);
  const assetQuery = trpc.posters.assetDirectory.useQuery(
    { path: assetProbe },
    { enabled: assetProbe.startsWith("/"), refetchOnWindowFocus: false, retry: false },
  );

  const handleSave = async () => {
    if (!accentValid) {
      addToast("Accent must be a hex colour like #E5A00D", "error");
      return;
    }
    if (!assetDirValid) {
      addToast("The asset directory must be an absolute path", "error");
      return;
    }
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        collection_art_enabled: enabled,
        collection_art_default_template: template,
        collection_art_default_accent: accent,
        global_asset_directory: assetDir.trim(),
      });
      addToast("Appearance settings saved", "success");
      await utils.config.get.invalidate();
    } catch {
      addToast("Failed to save appearance settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    try {
      await startJob.mutateAsync({ jobId: "collection-art" });
      addToast("Generating collection artwork…", "success");
    } catch (err) {
      // A 409 here means it's already running, which is not a failure worth a
      // red toast — the user asked for the work and the work is happening.
      addToast(err instanceof Error ? err.message : "Could not start the artwork job", "error");
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={4} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <SettingsPageHeader title="Appearance" />

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Interface">
        <label className={styles.field}>
          <span className={styles.label}>Colour scheme</span>
          <div>
            <ThemeToggle />
          </div>
        </label>
        <p className={styles.hint}>Seeds new browsers; one already set keeps its own.</p>

        <div className={styles.field}>
          <span className={styles.label}>Interface size</span>
          <UiScalePicker />
        </div>
        <p className={styles.hint}>Scales text, spacing and controls together. Smaller fits more on a laptop screen.</p>
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Collection artwork">
        <p className={styles.hint}>Defaults for rules that opt into generated posters.</p>

        <label className={styles.field}>
          <span className={styles.label}>Generate collection artwork</span>
          <div>
            <ToggleSwitch checked={enabled} onChange={setEnabled} />
          </div>
        </label>
        <p className={styles.hint}>Off stops uploads; existing posters stay.</p>

        <div className={styles.field}>
          <span className={styles.label} id="default-template">
            Default template
          </span>
          <div className={controls.segmented} role="radiogroup" aria-labelledby="default-template">
            {TEMPLATES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={template === t.value}
                title={t.title}
                className={`${controls.segmentedItem} ${template === t.value ? controls.segmentedItemActive : ""}`}
                onClick={() => setTemplate(t.value)}
                disabled={!enabled}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="default-accent">
            Default accent
          </label>
          <ColorField id="default-accent" value={accent} onChange={setAccent} disabled={!enabled} />
          {!accentValid && <p className={styles.hint}>Saved value isn't a hex colour — pick one or choose Auto.</p>}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Asset directory</span>
          <input
            className={styles.input}
            value={assetDir}
            onChange={(e) => setAssetDir(e.target.value)}
            placeholder="/config/assets"
            spellCheck={false}
            aria-invalid={!assetDirValid}
          />
        </label>
        <p className={styles.hint}>
          {!assetDirValid
            ? "Use an absolute path, like /config/assets."
            : assetDir.trim() === "" || !assetQuery.data
              ? "Kometa layout: <Name>/poster.jpg or <Name>.jpg."
              : (assetQuery.data.error ??
                `Found ${assetQuery.data.found.toLocaleString()} asset${assetQuery.data.found === 1 ? "" : "s"}.`)}
        </p>

        <div className={styles.field}>
          <span className={styles.label}>Preview</span>
          <CollectionPosterPreview
            title="Directed by Christopher Nolan"
            presentation={{ ...DEFAULT_PRESENTATION, poster: template, accentColor: accent || undefined }}
            enabled={enabled && accentValid}
          />
        </div>

        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={handleRunNow}
            disabled={!enabled || startJob.isPending}
          >
            {startJob.isPending ? "Starting…" : "Generate artwork now"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
        <p className={styles.hint}>
          Runs after the nightly rules as the <Link to="/jobs/collection-art">Generate Collection Artwork</Link> job.
        </p>
      </CardSection>
    </div>
  );
}
