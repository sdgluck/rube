import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PRESENTATION } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ToggleSwitch from "#components/ToggleSwitch";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import CollectionPosterPreview from "#components/CollectionPosterPreview";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

type DefaultTemplate = "gradient" | "mosaic" | "spotlight";

const TEMPLATES: { value: DefaultTemplate; label: string; hint: string }[] = [
  {
    value: "gradient",
    label: "Gradient",
    hint: "A coloured plate with the title set large. Never depends on the collection's items looking good together.",
  },
  {
    value: "mosaic",
    label: "Mosaic",
    hint: "A grid of the collection's own posters, darkened, with the title over it. 2×2 or 3×2 depending on how much art there is.",
  },
  {
    value: "spotlight",
    label: "Spotlight",
    hint: "One member's poster framed over a blurred copy of itself.",
  },
];

export default function SettingsAppearance() {
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState<DefaultTemplate>("gradient");
  const [accent, setAccent] = useState("");
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
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      enabled !== (configQuery.data.collection_art_enabled ?? true) ||
      template !== ((configQuery.data.collection_art_default_template as DefaultTemplate) ?? "gradient") ||
      accent !== (configQuery.data.collection_art_default_accent ?? "")
    );
  }, [enabled, template, accent, configQuery.data]);

  useUnsavedChanges(isDirty);

  const accentValid = accent === "" || /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent);

  const handleSave = async () => {
    if (!accentValid) {
      addToast("Accent must be a hex colour like #E5A00D", "error");
      return;
    }
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        collection_art_enabled: enabled,
        collection_art_default_template: template,
        collection_art_default_accent: accent,
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

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Collection artwork">
        <p className={styles.hint}>
          Tinkerbell can generate a poster for each collection its rules build, so a shelf of generated collections
          reads as designed rather than as Plex's grey four-poster mosaic. Artwork is opted into <em>per rule</em>, in
          the rule wizard — this page sets the defaults those rules start from, and the switch that stops all of it at
          once.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Generate collection artwork</span>
          <div>
            <ToggleSwitch checked={enabled} onChange={setEnabled} />
          </div>
        </label>
        <p className={styles.hint}>
          Off stops every upload immediately, without editing a single rule. Collections keep whatever artwork they
          already have — turning this off doesn't put the old posters back, because Plex regenerates a collection's
          default mosaic from its members.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Default template</span>
          <select
            className={styles.input}
            value={template}
            onChange={(e) => setTemplate(e.target.value as DefaultTemplate)}
            disabled={!enabled}
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint}>{TEMPLATES.find((t) => t.value === template)?.hint}</p>

        <label className={styles.field}>
          <span className={styles.label}>Default accent</span>
          <input
            className={styles.input}
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            placeholder="#E5A00D — leave blank to take the colour from each collection's own posters"
            disabled={!enabled}
            aria-invalid={!accentValid}
          />
        </label>
        <p className={styles.hint}>
          {accentValid
            ? "Blank is usually the better answer: each poster takes its colour from the films in it, which is what makes a generated set look like it belongs to the library rather than to a theme."
            : "Use a hex colour like #E5A00D, or leave it blank."}
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
          Artwork is generated by the <strong>Generate Collection Artwork</strong> job, which runs after the nightly
          rule run rather than inside it — rendering a poster per collection is minutes of image work, and it has no
          business holding up the rules.
        </p>
      </CardSection>
    </div>
  );
}
