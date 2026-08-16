import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";
import { isServiceConfigured, RECOMMENDED_EVENTS, type OnboardingService } from "./services";

interface Props {
  service: OnboardingService;
  cfg: Record<string, unknown>;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One integration, as a card that unfolds into its form.
 *
 * Save/test semantics are lifted wholesale from the settings forms so the same
 * button doesn't mean two things in two places: **save always saves**, and a
 * failed probe is a warning rather than a veto. Someone entering credentials
 * for a service that happens to be down must still be able to store them.
 * (Plex is the documented exception, and lives in its own component.)
 */
export default function ServiceCard({ service, cfg, expanded, onToggle }: Props) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const saveConfig = trpc.config.save.useMutation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Offered pre-ticked, but only while the provider has no subscriptions of
  // its own — re-saving a card must never quietly overwrite a selection the
  // user made on the Settings page.
  const existingEvents = service.eventsKey ? ((cfg[service.eventsKey] as string[]) ?? []) : [];
  const [subscribe, setSubscribe] = useState(existingEvents.length === 0);

  const source = service.objectKey ? ((cfg[service.objectKey] as Record<string, unknown>) ?? {}) : cfg;
  const configured = isServiceConfigured(cfg, service);

  // Re-seeded from server config rather than held as the source of truth, so a
  // card reopened after a save shows what was stored (including the redaction
  // sentinel standing in for a secret the user needn't retype).
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const field of service.fields) {
      const value = source[field.key];
      seeded[field.key] = value === undefined || value === null ? "" : String(value);
    }
    setValues(seeded);
    // `source` is rebuilt every render; the config payload is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [cfg, service]);

  const testRadarr = trpc.testRadarr.useMutation();
  const testSonarr = trpc.testSonarr.useMutation();
  const testSeerr = trpc.testSeerr.useMutation();
  const testTmdb = trpc.testTmdb.useMutation();
  const testOmdb = trpc.testOmdb.useMutation();
  const testMdblist = trpc.testMdblist.useMutation();
  const testNotification = trpc.testNotification.useMutation();

  async function runProbe(): Promise<string> {
    const v = (key: string) => values[key] ?? "";
    switch (service.probe) {
      case "radarr": {
        const r = await testRadarr.mutateAsync({ url: v("global_radarr_url"), api_key: v("global_radarr_api_key") });
        return `Connected to ${r.instanceName}`;
      }
      case "sonarr": {
        const r = await testSonarr.mutateAsync({ url: v("global_sonarr_url"), api_key: v("global_sonarr_api_key") });
        return `Connected to ${r.instanceName}`;
      }
      case "seerr": {
        const r = await testSeerr.mutateAsync({ url: v("global_seerr_url"), api_key: v("global_seerr_api_key") });
        return `Connected — ${r.total} requests visible`;
      }
      case "tmdb": {
        const r = await testTmdb.mutateAsync({ api_key: v("global_tmdb_api_key") });
        return `Connected — found "${r.sample}"`;
      }
      case "omdb": {
        const r = await testOmdb.mutateAsync({ api_key: v("global_omdb_api_key") });
        return `Connected — found "${r.title}"`;
      }
      case "mdblist": {
        const r = await testMdblist.mutateAsync({ api_key: v("global_mdblist_api_key") });
        return `Connected as ${r.name}`;
      }
      case "notification": {
        // Sends for real, against stored config — hence Save first, below.
        await testNotification.mutateAsync({ service: service.id as never });
        return "Test notification sent";
      }
      default:
        return "Nothing to test";
    }
  }

  function payload() {
    const extras: Record<string, unknown> = {};
    // Subscriptions live beside the credentials, not inside the object, even
    // for an object-backed service like SMTP.
    if (service.eventsKey && subscribe) extras[service.eventsKey] = RECOMMENDED_EVENTS;

    if (!service.objectKey) {
      return { ...Object.fromEntries(service.fields.map((f) => [f.key, values[f.key] ?? ""])), ...extras };
    }
    const object: Record<string, unknown> = { ...(source as Record<string, unknown>) };
    for (const field of service.fields) {
      const raw = values[field.key] ?? "";
      object[field.key] = field.type === "number" ? Number(raw) : raw;
    }
    return { [service.objectKey]: object, ...extras };
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveConfig.mutateAsync(payload() as never);
      await utils.config.get.invalidate();
      addToast(`${service.title} saved`, "success");
    } catch (err) {
      addToast(`Couldn't save ${service.title}: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
      utils.health.status.invalidate();
      utils.onboarding.status.invalidate();
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      addToast(await runProbe(), "success");
    } catch (err) {
      addToast(`${service.title} test failed: ${(err as Error).message}`, "error");
    } finally {
      setTesting(false);
      utils.health.status.invalidate();
    }
  }

  return (
    <div className={`${styles.tile} ${expanded ? styles.tileExpanded : ""}`}>
      <button type="button" className={styles.tileHead} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.tileTitle}>
          {configured && <span className={styles.tileDot} aria-hidden="true" />}
          {service.title}
        </span>
        <span className={styles.tileState}>{configured ? "Connected" : "Set up"}</span>
      </button>
      {service.blurb && <p className={styles.tileBlurb}>{service.blurb}</p>}
      {expanded && (
        <div className={styles.tileBody}>
          {service.fields.map((field) => (
            <label key={field.key} className={styles.field}>
              <span className={styles.fieldLabel}>{field.label}</span>
              <input
                className={controls.input}
                type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
              {field.hint && <span className={styles.fieldHint}>{field.hint}</span>}
            </label>
          ))}
          {service.eventsKey && (
            <label className={styles.checkField}>
              <input
                type="checkbox"
                className={controls.checkbox}
                checked={subscribe}
                onChange={(e) => setSubscribe(e.target.checked)}
              />
              <span>Tell me when a job or a health check fails</span>
            </label>
          )}
          <div className={styles.tileActions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {service.probe && (
              <button
                type="button"
                className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? "Testing…" : service.probe === "notification" ? "Send test" : "Test"}
              </button>
            )}
          </div>
          {service.probe === "notification" && (
            <p className={styles.fieldHint}>Save first — the test sends a real message using the stored settings.</p>
          )}
        </div>
      )}
    </div>
  );
}
