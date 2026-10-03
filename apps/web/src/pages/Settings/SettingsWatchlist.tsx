import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import CardSection from "#components/CardSection";
import { formatRelativeShort } from "#/format";
import { describeCron } from "#/utils";
import SettingsPageLink from "#components/SettingsPageLink";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import styles from "./SettingsWatchlist.module.css";

type ArrService = "radarr" | "sonarr";

interface TargetState {
  enabled: boolean;
  instanceId?: string;
  qualityProfileId: number;
  rootFolderPath: string;
  monitor: boolean;
  searchOnAdd: boolean;
}

interface FormState {
  enabled: boolean;
  radarr: TargetState;
  sonarr: TargetState;
  removeOnAvailable: boolean;
  maxAddsPerRun: number;
  dryRun: boolean;
}

const EMPTY_TARGET: TargetState = {
  enabled: false,
  qualityProfileId: 0,
  rootFolderPath: "",
  monitor: true,
  searchOnAdd: true,
};

/**
 * Dry run on, everything else off. The first save somebody makes here schedules
 * unattended writes to Radarr and Sonarr, and the honest default is the one
 * that shows them what would happen before it happens.
 */
const DEFAULTS: FormState = {
  enabled: false,
  radarr: { ...EMPTY_TARGET },
  sonarr: { ...EMPTY_TARGET },
  removeOnAvailable: false,
  maxAddsPerRun: 20,
  dryRun: true,
};

const SERVICE_LABEL: Record<ArrService, string> = { radarr: "Radarr", sonarr: "Sonarr" };
const SERVICE_KIND: Record<ArrService, string> = { radarr: "films", sonarr: "series" };

const PILL_CLASS: Record<string, string> = {
  new: styles.pillNew,
  requested: styles.pillRequested,
  present: styles.pillPresent,
  skipped: styles.pillSkipped,
  failed: styles.pillFailed,
};

const STATUS_LABEL: Record<string, string> = {
  new: "Pending",
  requested: "Requested",
  present: "In library",
  skipped: "Skipped",
  failed: "Failed",
};

/**
 * Plex Watchlist → Radarr/Sonarr.
 *
 * The settings and the activity table live on one page deliberately. Every
 * question this feature raises — did it see my item, why didn't it request it,
 * what is it waiting for — is answered by the ledger, and a configuration
 * screen that sends people somewhere else to find out whether it worked is a
 * screen they cannot trust.
 */
export default function SettingsWatchlist() {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saved, setSaved] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const listQuery = trpc.watchlist.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const retryMutation = trpc.watchlist.retry.useMutation();
  const arrStatusQuery = trpc.arr.status.useQuery(undefined, { staleTime: 60_000 });

  useEffect(() => {
    const stored = configQuery.data?.watchlist_sync;
    if (!stored) return;
    const next: FormState = {
      ...DEFAULTS,
      ...stored,
      radarr: { ...EMPTY_TARGET, ...stored.radarr },
      sonarr: { ...EMPTY_TARGET, ...stored.sonarr },
    };
    setForm(next);
    setSaved(next);
  }, [configQuery.data]);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  useUnsavedChanges(isDirty);

  const setTarget = (service: ArrService, patch: Partial<TargetState>) =>
    setForm((f) => ({ ...f, [service]: { ...f[service], ...patch } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({ watchlist_sync: form });
      setSaved(form);
      addToast("Watchlist settings saved", "success");
      await utils.config.get.invalidate();
    } catch {
      addToast("Failed to save watchlist settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async (guid: string) => {
    try {
      await retryMutation.mutateAsync({ guid });
      await utils.watchlist.list.invalidate();
      addToast("Queued for the next sync", "success");
    } catch {
      addToast("Couldn't queue that item", "error");
    }
  };

  const items = listQuery.data?.items ?? [];
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const syncJob = jobsQuery.data?.find((j) => j.id === "watchlist-sync");
  const syncSchedule = syncJob?.schedule;
  const account = listQuery.data?.account;
  const armed = form.enabled && !form.dryRun && (form.radarr.enabled || form.sonarr.enabled);

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Watchlist" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Plex Watchlist sync">
        <p className={styles.scopeNote}>
          {form.enabled ? "Syncing" : "Syncs"}{" "}
          {account ? (
            <strong>@{account}</strong>
          ) : (
            <SettingsPageLink to="/settings/plex">your Plex account</SettingsPageLink>
          )}
          {syncJob?.lastRunStartedAt != null &&
            (syncJob.lastRunStatus === "failed"
              ? " · last check failed"
              : ` · checked ${formatRelativeShort(syncJob.lastRunStartedAt)}`)}
        </p>

        <label className={styles.switchRow}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <span>
            <span className={styles.switchLabel}>Sync my Plex watchlist</span>
            {syncSchedule && (
              <span className={styles.switchHint}>
                {describeCron(syncSchedule)}; missing titles go to Radarr or Sonarr.
              </span>
            )}
          </span>
        </label>

        {armed && (
          <div className={styles.armed} role="status">
            Live — new watchlist items go to{" "}
            {[form.radarr.enabled && "Radarr", form.sonarr.enabled && "Sonarr"].filter(Boolean).join(" and ")} without
            confirmation.
          </div>
        )}

        <label className={styles.switchRow}>
          <input
            type="checkbox"
            checked={form.dryRun}
            onChange={(e) => setForm((f) => ({ ...f, dryRun: e.target.checked }))}
          />
          <span>
            <span className={styles.switchLabel}>Dry run — log what would be requested, don't request it</span>
            <span className={styles.switchHint}>Pending items are picked up when this goes off.</span>
          </span>
        </label>

        <div className={settings.field}>
          <label className={settings.label} htmlFor="watchlist-cap">
            Most items to request per run
          </label>
          <input
            id="watchlist-cap"
            type="number"
            min={1}
            max={500}
            className={settings.input}
            value={form.maxAddsPerRun}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxAddsPerRun: Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)),
              }))
            }
          />
          <p className={settings.hint}>Shared by Radarr and Sonarr; the rest wait for later runs.</p>
        </div>

        <label className={styles.switchRow}>
          <input
            type="checkbox"
            checked={form.removeOnAvailable}
            onChange={(e) => setForm((f) => ({ ...f, removeOnAvailable: e.target.checked }))}
          />
          <span>
            <span className={styles.switchLabel}>Remove items from my watchlist once they've arrived</span>
            <span className={styles.switchHint}>Edits your Plex account.</span>
          </span>
        </label>
      </CardSection>

      {(["radarr", "sonarr"] as const).map((service) => (
        <TargetCard
          key={service}
          service={service}
          target={form[service]}
          configured={arrStatusQuery.data?.[service] ?? false}
          onChange={(patch) => setTarget(service, patch)}
        />
      ))}

      <div className={settings.buttons}>
        <button className={settings.button} onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Recent watchlist activity">
        {items.length === 0 ? (
          <p className={styles.empty}>Nothing seen yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.guid}>
                  <td>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.year ? <span className={styles.itemYear}>{item.year}</span> : null}
                  </td>
                  <td>
                    <span className={`${styles.pill} ${PILL_CLASS[item.status] ?? styles.pillPresent}`}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className={styles.reason}>{item.error || item.externalId || "—"}</td>
                  <td className={styles.reason}>{formatRelativeShort(item.firstSeenAt)}</td>
                  <td>
                    {item.status === "skipped" || item.status === "failed" ? (
                      <button
                        className={styles.retry}
                        onClick={() => handleRetry(item.guid)}
                        disabled={retryMutation.isPending}
                      >
                        Try again
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>
    </div>
  );
}

/**
 * Where one service's adds land.
 *
 * Its own card per \*Arr because the two never share a root folder or a
 * quality profile on a real install, and a single block that implies they do
 * is how every watchlisted series ends up in the movies directory.
 */
function TargetCard(props: {
  service: ArrService;
  target: TargetState;
  configured: boolean;
  onChange: (patch: Partial<TargetState>) => void;
}) {
  const { service, target, configured, onChange } = props;
  const label = SERVICE_LABEL[service];

  const instancesQuery = trpc.arr.instances.useQuery(undefined, { staleTime: 60_000 });
  const profilesQuery = trpc.arr.qualityProfiles.useQuery(
    { service, instanceId: target.instanceId || undefined },
    { enabled: configured && target.enabled, staleTime: 60_000 },
  );
  const foldersQuery = trpc.arr.rootFolders.useQuery(
    { service, instanceId: target.instanceId || undefined },
    { enabled: configured && target.enabled, staleTime: 60_000 },
  );

  const instances = (instancesQuery.data ?? []).filter((i) => i.service === service);
  const profiles = profilesQuery.data ?? [];
  const folders = foldersQuery.data ?? [];

  return (
    <CardSection
      className={settings.group}
      titleClassName={settings.groupTitle}
      title={`${label} — watchlisted ${SERVICE_KIND[service]}`}
    >
      {!configured && (
        <p className={settings.hint}>
          {label} isn't connected — <SettingsPageLink to="/settings/arrs" />
        </p>
      )}

      <label className={styles.switchRow}>
        <input
          type="checkbox"
          checked={target.enabled}
          disabled={!configured}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <span>
          <span className={styles.switchLabel}>
            Send watchlisted {SERVICE_KIND[service]} to {label}
          </span>
        </span>
      </label>

      {target.enabled && (
        <>
          {/* Only shown once there is a choice to make, as in the rule wizard:
              on a single-instance setup a picker with one entry is a control
              asking a question with one answer. */}
          {instances.length > 1 && (
            <div className={settings.field}>
              <label className={settings.label} htmlFor={`${service}-instance`}>
                Instance
              </label>
              <select
                id={`${service}-instance`}
                className={settings.input}
                value={target.instanceId ?? ""}
                onChange={(e) =>
                  // A profile id from one server means something else entirely
                  // on another, so both choices are cleared with the instance.
                  onChange({ instanceId: e.target.value, qualityProfileId: 0, rootFolderPath: "" })
                }
              >
                {instances.map((i) => (
                  <option key={i.id} value={i.isDefault ? "" : i.id}>
                    {i.name}
                    {i.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={settings.field}>
            <label className={settings.label} htmlFor={`${service}-quality`}>
              Quality profile
            </label>
            <select
              id={`${service}-quality`}
              className={settings.input}
              value={target.qualityProfileId}
              onChange={(e) => onChange({ qualityProfileId: parseInt(e.target.value, 10) || 0 })}
            >
              <option value={0}>{profilesQuery.isLoading ? "Loading…" : "— pick a profile —"}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {profilesQuery.error && (
              <p className={settings.hint}>Couldn't load profiles: {profilesQuery.error.message}</p>
            )}
          </div>

          <div className={settings.field}>
            <label className={settings.label} htmlFor={`${service}-root`}>
              Root folder
            </label>
            <select
              id={`${service}-root`}
              className={settings.input}
              value={target.rootFolderPath}
              onChange={(e) => onChange({ rootFolderPath: e.target.value })}
            >
              <option value="">{foldersQuery.isLoading ? "Loading…" : "— pick a folder —"}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            {foldersQuery.error && <p className={settings.hint}>Couldn't load folders: {foldersQuery.error.message}</p>}
          </div>

          <label className={styles.switchRow}>
            <input type="checkbox" checked={target.monitor} onChange={(e) => onChange({ monitor: e.target.checked })} />
            <span>
              <span className={styles.switchLabel}>Monitor added items</span>
            </span>
          </label>

          <label className={styles.switchRow}>
            <input
              type="checkbox"
              checked={target.searchOnAdd}
              onChange={(e) => onChange({ searchOnAdd: e.target.checked })}
            />
            <span>
              <span className={styles.switchLabel}>Search on add</span>
              <span className={styles.switchHint}>Off waits for {label}'s next scheduled search.</span>
            </span>
          </label>
        </>
      )}
    </CardSection>
  );
}
