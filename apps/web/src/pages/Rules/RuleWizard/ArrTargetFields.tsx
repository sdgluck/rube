/**
 * Where one service files what a rule sends it: instance, quality profile and
 * root folder.
 *
 * A component of its own, one per service, because each owns two queries
 * against its own server — a Radarr profile id means nothing on Sonarr, which
 * is exactly the bug a single shared set of fields used to cause.
 */
import type { ArrService } from "@rube/contracts";
import SettingsPageLink from "#components/SettingsPageLink";
import { trpc } from "#/trpc";
import shared from "#/styles/shared.module.css";
import styles from "./RuleWizard.module.css";
import type { ArrTargetForm } from "./types.ts";

export const ARR_SERVICE_LABEL: Record<ArrService, string> = { radarr: "Radarr", sonarr: "Sonarr" };

interface Props {
  service: ArrService;
  value: ArrTargetForm;
  onChange: (patch: Partial<ArrTargetForm>) => void;
  /** Whether to load profiles and folders — only once the action is enabled. */
  active: boolean;
  /** Show the service's name above its fields, when there is more than one. */
  titled: boolean;
}

export default function ArrTargetFields({ service, value, onChange, active, titled }: Props) {
  const label = ARR_SERVICE_LABEL[service];
  const statusQuery = trpc.arr.status.useQuery(undefined, { staleTime: 60_000 });
  const configured = !!statusQuery.data?.[service];
  const instancesQuery = trpc.arr.instances.useQuery(undefined, { staleTime: 60_000 });
  const instances = (instancesQuery.data ?? []).filter((i) => i.service === service);
  // Quality profiles and root folders belong to one instance, so switching
  // instance has to re-ask rather than reuse the other one's answers.
  const target = { service, instanceId: value.instanceId || undefined };
  const profilesQuery = trpc.arr.qualityProfiles.useQuery(target, {
    enabled: configured && active,
    staleTime: 60_000,
  });
  const foldersQuery = trpc.arr.rootFolders.useQuery(target, { enabled: configured && active, staleTime: 60_000 });
  const profiles = profilesQuery.data ?? [];
  const folders = foldersQuery.data ?? [];

  return (
    <>
      {titled && <h4 className={styles.subLabel}>{service === "radarr" ? "Films → Radarr" : "TV → Sonarr"}</h4>}
      {titled && active && configured && (
        <span className={styles.hint}>Leave blank to not send {service === "radarr" ? "films" : "shows"}.</span>
      )}
      {!configured && statusQuery.isSuccess && (
        <div className={styles.field}>
          <span className={styles.typeCardWarn}>
            Needs {label} · <SettingsPageLink to="/settings/arrs" />
          </span>
        </div>
      )}
      {active && configured && (
        <>
          {/* Only shown once there is a choice to make. On the single-instance
              setup almost everyone has, a picker with one entry is a control
              that asks a question with one answer. */}
          {instances.length > 1 && (
            <div className={styles.field}>
              <label htmlFor={`arr-${service}-instance`}>{label} instance</label>
              <select
                id={`arr-${service}-instance`}
                className={shared.input}
                value={value.instanceId}
                onChange={(e) =>
                  // Changing instance invalidates both — a profile id from
                  // one server means something else entirely on another.
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

          <div className={styles.field}>
            <label htmlFor={`arr-${service}-quality`}>Quality profile</label>
            <select
              id={`arr-${service}-quality`}
              className={shared.input}
              value={value.qualityProfileId}
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
              <span className={styles.hint}>Couldn't load profiles: {profilesQuery.error.message}</span>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor={`arr-${service}-root`}>Root folder</label>
            <select
              id={`arr-${service}-root`}
              className={shared.input}
              value={value.rootFolderPath}
              onChange={(e) => onChange({ rootFolderPath: e.target.value })}
            >
              <option value="">{foldersQuery.isLoading ? "Loading…" : "— pick a folder —"}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            {foldersQuery.error && (
              <span className={styles.hint}>Couldn't load folders: {foldersQuery.error.message}</span>
            )}
          </div>
        </>
      )}
    </>
  );
}
