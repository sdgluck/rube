import { useEffect, useState } from "react";
import { useFieldAction, type FieldValues } from "#pages/Settings/Notifications/NotificationServiceForm";
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
  const [values, setValues] = useState<FieldValues>({});
  const [seeded, setSeeded] = useState<FieldValues>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { runAction, running } = useFieldAction(setValues);

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
    const next: FieldValues = {};
    for (const field of service.fields) {
      if (field.derived) continue;
      const value = source[field.key];
      next[field.key] =
        field.type === "checkbox" ? value === true : value === undefined || value === null ? "" : String(value);
    }
    setValues(next);
    setSeeded(next);
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
    const v = (key: string) => String(values[key] ?? "");
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
        // Sends for real, against stored config — `handleTest` saves first.
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

    const stored: Record<string, unknown> = {};
    for (const field of service.fields) {
      if (field.derived) continue;
      const raw = values[field.key] ?? "";
      stored[field.key] =
        field.type === "number" ? Number(raw) || 0 : field.type === "checkbox" ? raw === true : String(raw);
    }
    if (!service.objectKey) return { ...stored, ...extras };
    return { [service.objectKey]: { ...(source as Record<string, unknown>), ...stored }, ...extras };
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(seeded);

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      await saveConfig.mutateAsync(payload() as never);
      await utils.config.get.invalidate();
      return true;
    } catch (err) {
      addToast(`Couldn't save ${service.title}: ${(err as Error).message}`, "error");
      return false;
    } finally {
      setSaving(false);
      utils.health.status.invalidate();
      utils.onboarding.status.invalidate();
    }
  }

  async function handleSave() {
    if (await save()) addToast(`${service.title} saved`, "success");
  }

  // A notification test sends from stored config, so unsaved edits are saved
  // first — otherwise "Send test" would test the previous credentials and
  // report on something other than what is on screen.
  async function handleTest() {
    if (service.probe === "notification" && dirty && !(await save())) return;
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
          {service.fields.map((field) =>
            field.hidden ? null : field.derived ? (
              <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>{field.label}</span>
                <select
                  className={controls.select}
                  value={field.derived.read(values)}
                  onChange={(e) => {
                    const patch = field.derived!.write(e.target.value, values);
                    setValues((prev) => ({ ...prev, ...patch }));
                  }}
                >
                  {field.derived.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {field.hint && <span className={styles.fieldHint}>{field.hint}</span>}
              </label>
            ) : field.type === "checkbox" ? (
              <label key={field.key} className={styles.checkField}>
                <input
                  type="checkbox"
                  className={controls.checkbox}
                  checked={values[field.key] === true}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <label key={field.key} className={styles.field}>
                <span className={styles.fieldLabel}>{field.label}</span>
                <span className={field.action ? styles.inputAction : undefined}>
                  <input
                    className={controls.input}
                    type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
                    placeholder={field.placeholder}
                    value={String(values[field.key] ?? "")}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                  {field.action && (
                    <button
                      type="button"
                      className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                      onClick={() => runAction(field, values)}
                      disabled={running !== null}
                    >
                      {running === field.key ? field.action.busyLabel : field.action.label}
                    </button>
                  )}
                </span>
                {field.hint && <span className={styles.fieldHint}>{field.hint}</span>}
              </label>
            ),
          )}
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
                disabled={testing || saving}
              >
                {testing ? "Testing…" : service.probe === "notification" ? "Send test" : "Test"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
