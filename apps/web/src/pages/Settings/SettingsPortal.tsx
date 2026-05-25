import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { PORTAL_ICONS, getPortalIcon, DEFAULT_PORTAL_ICON } from "#lib/portalIcons";
import styles from "./Personalization.module.css";

const DEFAULT_COLOR = "#e5a00d";

interface BrandingForm {
  title: string;
  icon: string;
  iconColor: string;
  backgroundImage: string;
}

const EMPTY: BrandingForm = { title: "", icon: DEFAULT_PORTAL_ICON, iconColor: DEFAULT_COLOR, backgroundImage: "" };

export default function SettingsPortal() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery();
  const saveMutation = trpc.config.save.useMutation();
  const [form, setForm] = useState<BrandingForm>(EMPTY);

  useEffect(() => {
    const b = configQuery.data?.portal_branding;
    if (!b) return;
    setForm({
      title: b.title ?? "",
      icon: b.icon ?? DEFAULT_PORTAL_ICON,
      iconColor: b.iconColor ?? DEFAULT_COLOR,
      backgroundImage: b.backgroundImage ?? "",
    });
  }, [configQuery.data]);

  function save() {
    saveMutation.mutate(
      {
        portal_branding: {
          title: form.title.trim() || undefined,
          icon: form.icon,
          iconColor: form.iconColor,
          backgroundImage: form.backgroundImage.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          addToast("Portal appearance saved", "success");
          utils.config.get.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  const PreviewIcon = getPortalIcon(form.icon);
  const title = form.title.trim() || "Tinkerbell";

  return (
    <div>
      <h3>Portal Appearance</h3>
      <p>Customise the Sign-in-with-Plex portal that your users see.</p>

      <div className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Header title</span>
          <input
            className={styles.input}
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Tinkerbell"
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Header icon</span>
          <div className={styles.iconGrid}>
            {PORTAL_ICONS.map((name) => {
              const Icon = getPortalIcon(name);
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  className={`${styles.iconBtn} ${form.icon === name ? styles.active : ""}`}
                  onClick={() => setForm({ ...form, icon: name })}
                >
                  <Icon size={20} color={form.icon === name ? form.iconColor : undefined} />
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Icon colour</span>
          <div className={styles.colorRow}>
            <input
              type="color"
              value={form.iconColor}
              onChange={(e) => setForm({ ...form, iconColor: e.target.value })}
            />
            <input
              className={styles.input}
              type="text"
              value={form.iconColor}
              onChange={(e) => setForm({ ...form, iconColor: e.target.value })}
              style={{ width: 120 }}
            />
          </div>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Background image URL</span>
          <span className={styles.hint}>Shown behind the portal. Leave blank for a plain background.</span>
          <input
            className={styles.input}
            type="text"
            value={form.backgroundImage}
            onChange={(e) => setForm({ ...form, backgroundImage: e.target.value })}
            placeholder="https://example.com/backdrop.jpg"
          />
        </label>

        <div>
          <button type="button" className={styles.primary} onClick={save} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save appearance"}
          </button>
        </div>
      </div>

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Preview</h4>
      <div className={styles.preview}>
        <div
          className={styles.previewStage}
          style={
            form.backgroundImage.trim()
              ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url("${form.backgroundImage.trim()}")`,
                }
              : undefined
          }
        >
          <div className={styles.previewCard}>
            <div className={styles.previewTitle}>
              <PreviewIcon size={28} color={form.iconColor} />
              {title}
            </div>
            <p className={styles.previewLede}>Sign in with your Plex account to personalize your home screen.</p>
            <button type="button" className={styles.previewBtn} disabled>
              Sign in with Plex
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
