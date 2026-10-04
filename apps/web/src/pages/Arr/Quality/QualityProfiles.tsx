import { useState } from "react";
import { sizeLimitSchema } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { StatusChip } from "#components/PageShell";
import ConfirmModal from "#components/ConfirmModal";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import { SkeletonTable } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import ApplyPresetModal, { type ApplyTarget } from "./ApplyPresetModal";
import { asStatus, STATUS_LABEL, STATUS_TONE } from "./quality";
import styles from "./Quality.module.css";

interface Opening {
  target: ApplyTarget;
  presetId?: string;
  limits?: unknown;
}

/**
 * An instance's quality profiles, and which of them Tinkerbell manages.
 *
 * Every profile on the instance is listed, not only the managed ones. Taking
 * over an existing profile is the commonest way in, because almost every
 * install already has an "HD-1080p" that films are assigned to, and creating
 * a new profile beside it would leave the library on the old one.
 */
export default function QualityProfiles({ instanceId }: { instanceId: string }) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const profiles = trpc.arr.quality.profiles.useQuery({ instanceId });
  const presets = trpc.arr.quality.presets.useQuery({ instanceId });
  const snapshots = trpc.arr.quality.snapshots.useQuery({ instanceId });

  const [opening, setOpening] = useState<Opening | null>(null);
  const [detaching, setDetaching] = useState<{ id: string; name: string } | null>(null);
  const [restoring, setRestoring] = useState<{ id: string; reason: string } | null>(null);

  const invalidate = () => void utils.arr.quality.invalidate();

  const restore = trpc.arr.quality.restore.useMutation({
    onSuccess: (data) => {
      invalidate();
      void utils.arr.qualityProfiles.invalidate();
      if (data.warnings.length > 0) addToast(`Restored, with problems: ${data.warnings.join("; ")}`, "error", 12000);
      else addToast(`Restored ${data.restored} records`, "success");
    },
    onError: (err) => addToast(err.message, "error"),
  });
  const detach = trpc.arr.quality.detach.useMutation({
    onSuccess: () => {
      invalidate();
      addToast("No longer managed. The profile is unchanged in the instance.", "success");
    },
    onError: (err) => addToast(err.message, "error"),
  });
  const check = trpc.arr.quality.checkDrift.useMutation({
    onSuccess: (rows) => {
      invalidate();
      const off = rows.filter((r) => r.status !== "in_sync").length;
      addToast(off === 0 ? "Every managed profile matches its preset" : `${off} profile(s) need attention`, "info");
    },
    onError: (err) => addToast(err.message, "error"),
  });

  if (profiles.isPending || presets.isPending) return <SkeletonTable rows={4} columns={4} />;
  if (profiles.isError || presets.isError) {
    const error = profiles.error ?? presets.error;
    return (
      <ErrorState
        title="Couldn't read this instance's quality profiles"
        error={error}
        onRetry={() => {
          void profiles.refetch();
          void presets.refetch();
        }}
      />
    );
  }

  const presetName = (id: string) => presets.data.presets.find((p) => p.id === id)?.name ?? id;
  const noneAvailable = presets.data.presets.every((p) => !p.available);
  const managedCount = profiles.data.profiles.filter((p) => p.managed).length + profiles.data.orphans.length;

  return (
    <section className={styles.section} aria-labelledby="quality-profiles">
      <header className={styles.sectionHead}>
        <h3 id="quality-profiles" className={styles.sectionTitle}>
          Quality profiles
        </h3>
        <div className={styles.sectionActions}>
          {managedCount > 0 && (
            <button
              type="button"
              className={`${controls.btn} ${controls.btnSecondary}`}
              disabled={check.isPending}
              onClick={() => check.mutate({ instanceId })}
            >
              {check.isPending ? "Checking…" : "Check now"}
            </button>
          )}
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary}`}
            disabled={noneAvailable}
            onClick={() => setOpening({ target: { name: "" } })}
          >
            New from preset
          </button>
        </div>
      </header>

      {noneAvailable && (
        <p className={styles.warning}>
          {presets.data.presets[0]?.unavailableReason ?? "No preset suits this instance."}
        </p>
      )}

      <div className="table-scroll">
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Preset</th>
              <th title="Edits made elsewhere are flagged, never reverted">Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {profiles.data.profiles.map((p) => {
              const status = p.managed ? asStatus(p.managed.status) : null;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className={shared.cellMuted}>{p.managed ? presetName(p.managed.presetId) : "Not managed"}</td>
                  <td>
                    {status && (
                      <span className={styles.statusCell}>
                        <StatusChip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusChip>
                        {p.managed?.checkedAt && (
                          <span className={shared.cellMuted}>
                            <RelativeTime timestamp={p.managed.checkedAt} />
                          </span>
                        )}
                      </span>
                    )}
                    {p.managed?.lastError && <span className={styles.fieldError}>{p.managed.lastError}</span>}
                  </td>
                  <td className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.rowButton}
                      disabled={noneAvailable}
                      onClick={() =>
                        setOpening({
                          target: { profileId: p.id, profileName: p.name },
                          presetId: p.managed?.presetId,
                          limits: p.managed?.limits,
                        })
                      }
                    >
                      {!p.managed ? "Apply preset" : status === "in_sync" ? "Change preset" : "Review & re-apply"}
                    </button>
                    {p.managed && (
                      <button
                        type="button"
                        className={styles.rowButton}
                        onClick={() => setDetaching({ id: p.managed!.id, name: p.name })}
                      >
                        Stop managing
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {profiles.data.orphans.map((row) => (
              <tr key={row.id}>
                <td>{row.profileName}</td>
                <td className={shared.cellMuted}>{presetName(row.presetId)}</td>
                <td>
                  <StatusChip tone="error">{row.arrProfileId === null ? "Not created yet" : "Missing"}</StatusChip>
                </td>
                <td className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowButton}
                    onClick={() =>
                      setOpening({ target: { name: row.profileName }, presetId: row.presetId, limits: row.limits })
                    }
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    className={styles.rowButton}
                    onClick={() => setDetaching({ id: row.id, name: row.profileName })}
                  >
                    Forget
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(snapshots.data?.length ?? 0) > 0 && (
        <details className={styles.snapshots}>
          <summary className={styles.stepSummary}>Undo history</summary>
          <p className={styles.hint}>Taken before every apply; restoring undoes exactly that apply.</p>
          <div className="table-scroll">
            <table className={shared.table}>
              <tbody>
                {snapshots.data!.map((s) => (
                  <tr key={s.id}>
                    <td>{s.reason}</td>
                    <td className={shared.cellMuted}>
                      <RelativeTime timestamp={s.createdAt} />
                      {s.createdBy ? ` by ${s.createdBy}` : ""}
                    </td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowButton}
                        disabled={restore.isPending}
                        onClick={() => setRestoring({ id: s.id, reason: s.reason })}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {opening && (
        <ApplyPresetModal
          instanceId={instanceId}
          presets={presets.data.presets}
          target={opening.target}
          initialPresetId={opening.presetId}
          initialLimit={sizeLimitSchema.safeParse(opening.limits).data}
          onApplied={({ snapshotId, profileName, presetName: applied }) =>
            addToast(`Applied “${applied}” to ${profileName}`, "success", {
              action: { label: "Undo", onAction: () => restore.mutate({ snapshotId }) },
            })
          }
          onClose={() => setOpening(null)}
        />
      )}

      {detaching && (
        <ConfirmModal
          title={`Stop managing “${detaching.name}”?`}
          message="The profile stays in the instance exactly as it is. Tinkerbell stops checking it against the preset."
          confirmLabel="Stop managing"
          onConfirm={() => {
            detach.mutate({ managedId: detaching.id });
            setDetaching(null);
          }}
          onCancel={() => setDetaching(null)}
        />
      )}

      {restoring && (
        <ConfirmModal
          title="Restore this snapshot?"
          message={`Undo “${restoring.reason}”. Profiles and custom formats it created are deleted, and anything it changed is put back.`}
          confirmLabel="Restore"
          danger
          onConfirm={() => {
            restore.mutate({ snapshotId: restoring.id });
            setRestoring(null);
          }}
          onCancel={() => setRestoring(null)}
        />
      )}
    </section>
  );
}
