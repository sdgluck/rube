import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import CardSection from "#components/CardSection";
import styles from "#pages/Settings/Settings.module.css";

/**
 * Extra Radarr and Sonarr instances, beyond the pair on the tabs beside this.
 *
 * A split 4K instance is the norm in this community — a second Radarr with
 * its own root folders and quality profiles, often a third for anime — and
 * one url/key pair per service could not express it. A cleanup rule could not
 * delete from the right instance, and auto-add could not target one.
 *
 * These are additions, not replacements. The Radarr and Sonarr tabs stay
 * exactly as they were and remain the *default* instance of their service:
 * every rule that names no instance keeps talking to the server it always
 * did, and nothing needed migrating to get here.
 */

interface InstanceForm {
  id: string;
  service: "radarr" | "sonarr";
  name: string;
  url: string;
  apiKey: string;
}

/** Stable, and not a UUID: it goes in rule configs and export files. */
function newId(service: string): string {
  return `${service}-${Date.now().toString(36)}`;
}

export default function SettingsArrsInstances() {
  const [instances, setInstances] = useState<InstanceForm[]>([]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (!configQuery.data) return;
    setInstances((configQuery.data.global_arr_instances ?? []) as InstanceForm[]);
  }, [configQuery.data]);

  const saved = useMemo(() => (configQuery.data?.global_arr_instances ?? []) as InstanceForm[], [configQuery.data]);
  const isDirty = JSON.stringify(instances) !== JSON.stringify(saved);
  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    const cleaned = instances
      .map((i) => ({ ...i, name: i.name.trim(), url: i.url.trim() }))
      .filter((i) => i.name && i.url && i.apiKey);
    if (cleaned.length !== instances.length) {
      addToast("Instances need a name, a URL and an API key. Incomplete rows were dropped.", "info");
    }
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({ global_arr_instances: cleaned });
      await utils.config.get.invalidate();
      await utils.arr.instances.invalidate();
      setInstances(cleaned);
      addToast("Instances saved", "success");
    } catch (err) {
      addToast(`Failed to save: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const update = (id: string, patch: Partial<InstanceForm>) =>
    setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const add = (service: "radarr" | "sonarr") =>
    setInstances((prev) => [...prev, { id: newId(service), service, name: "", url: "", apiKey: "" }]);

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;

  return (
    <div className={styles.form}>
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Extra instances">
        <p className={styles.hint}>
          For a split setup — a second Radarr for 4K, a third for anime. The Radarr and Sonarr tabs remain the default
          instance of each service, and any rule that doesn&rsquo;t name an instance keeps using them.
        </p>

        {instances.length === 0 && <p className={styles.hint}>No extra instances. The defaults are all that run.</p>}

        {instances.map((instance) => (
          <div key={instance.id} className={styles.group}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={instance.name}
                placeholder="4K"
                onChange={(e) => update(instance.id, { name: e.target.value })}
              />
              <span className={styles.hint}>
                Shown wherever an instance is chosen, and in health checks as{" "}
                {instance.service === "radarr" ? "Radarr" : "Sonarr"} ({instance.name || "…"}).
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Service</span>
              <select
                className={styles.input}
                value={instance.service}
                onChange={(e) => update(instance.id, { service: e.target.value as "radarr" | "sonarr" })}
              >
                <option value="radarr">Radarr</option>
                <option value="sonarr">Sonarr</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>URL</span>
              <input
                className={styles.input}
                value={instance.url}
                placeholder="http://localhost:7878"
                onChange={(e) => update(instance.id, { url: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>API key</span>
              <input
                className={styles.input}
                type="password"
                value={instance.apiKey}
                onChange={(e) => update(instance.id, { apiKey: e.target.value })}
              />
            </label>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setInstances((prev) => prev.filter((i) => i.id !== instance.id))}
              >
                Remove
              </button>
              <span className={styles.hint}>
                Rules naming this instance fall back to the default one rather than failing.
              </span>
            </div>
          </div>
        ))}

        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => add("radarr")}>
            Add Radarr
          </button>
          <button type="button" className={styles.button} onClick={() => add("sonarr")}>
            Add Sonarr
          </button>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>
    </div>
  );
}
