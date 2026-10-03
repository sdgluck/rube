import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tinkerbell/trpc";
import { defaultCeiling, type SizeLimit } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import { basisLabel, formatChangeValue, formatRuntime, sizeExamples, stepHeading, withMaxGb } from "./quality";
import styles from "./Quality.module.css";

type Outputs = inferRouterOutputs<AppRouter>;
export type PresetOption = Outputs["arr"]["quality"]["presets"]["presets"][number];
type PlanResult = Outputs["arr"]["quality"]["plan"];

/** Either a new profile, or one that already exists on the instance. */
export type ApplyTarget = { name: string } | { profileId: number; profileName: string };

interface Props {
  instanceId: string;
  presets: PresetOption[];
  target: ApplyTarget;
  /** Preselected, for a re-apply or an imported row. */
  initialPresetId?: string;
  initialLimit?: SizeLimit;
  /** The page offers the undo: the toast outlives this dialog. */
  onApplied: (result: { snapshotId: string; profileName: string; presetName: string }) => void;
  onClose: () => void;
}

/**
 * Choose, preview, apply.
 *
 * Two steps on purpose. Nothing reaches the *Arr until the user has seen the
 * exact field changes, and the apply carries the preview's fingerprint so the
 * server refuses it if the instance moved in between. On that refusal the
 * preview is simply recomputed and shown again: the user's choice stands, and
 * only what it would change is new.
 */
export default function ApplyPresetModal({
  instanceId,
  presets,
  target,
  initialPresetId,
  initialLimit,
  onApplied,
  onClose,
}: Props) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const available = presets.filter((p) => p.available);
  const first = presets.find((p) => p.id === initialPresetId) ?? available[0] ?? presets[0];

  const [presetId, setPresetId] = useState(first?.id ?? "");
  const [limit, setLimit] = useState<SizeLimit>(
    initialLimit ?? first?.defaultLimit ?? { maxGb: 10, basisMinutes: 120, ceilingGb: null },
  );
  const [ceilingTouched, setCeilingTouched] = useState(initialLimit !== undefined);
  const [name, setName] = useState("profileId" in target ? target.profileName : target.name || (first?.name ?? ""));
  const [preview, setPreview] = useState<PlanResult | null>(null);

  const preset = presets.find((p) => p.id === presetId);
  const isNew = !("profileId" in target);

  const request = () => ({
    instanceId,
    presetId,
    limit,
    target: "profileId" in target ? { profileId: target.profileId } : { name: name.trim() },
  });

  const plan = trpc.arr.quality.plan.useMutation({
    onSuccess: (data) => setPreview(data),
    onError: (err) => addToast(err.message, "error"),
  });

  const apply = trpc.arr.quality.applyPreset.useMutation({
    onSuccess: (data) => {
      void utils.arr.quality.invalidate();
      void utils.arr.qualityProfiles.invalidate();
      onApplied({ snapshotId: data.snapshotId, profileName: data.managed.profileName, presetName: preset?.name ?? "" });
      onClose();
    },
    onError: (err) => {
      if (err.data?.code === "CONFLICT") {
        addToast("The instance changed since this preview. Here is the updated one.", "info");
        plan.mutate(request());
        return;
      }
      // A partial apply leaves a snapshot behind, which the page lists.
      void utils.arr.quality.snapshots.invalidate();
      addToast(err.message, "error", 12000);
    },
  });

  function choosePreset(next: PresetOption) {
    setPresetId(next.id);
    setLimit(next.defaultLimit);
    setCeilingTouched(false);
    if (isNew && (name === "" || presets.some((p) => p.name === name))) setName(next.name);
  }

  const tooSmall = preset ? limit.maxGb < preset.minimumGb : false;
  const canPreview = !!preset?.available && !tooSmall && (!isNew || name.trim() !== "") && !plan.isPending;

  const footer = preview ? (
    <div className={styles.modalActions}>
      <button type="button" className={controls.btnGhost} onClick={() => setPreview(null)} disabled={apply.isPending}>
        Back
      </button>
      <button
        type="button"
        className={controls.btnPrimary}
        disabled={apply.isPending}
        onClick={() => apply.mutate({ ...request(), fingerprint: preview.fingerprint })}
      >
        {preview.plan.steps.length === 0
          ? "Manage this profile"
          : `Apply ${preview.plan.steps.length} change${preview.plan.steps.length === 1 ? "" : "s"}`}
      </button>
    </div>
  ) : (
    <div className={styles.modalActions}>
      <button type="button" className={controls.btnGhost} onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className={controls.btnPrimary}
        disabled={!canPreview}
        onClick={() => plan.mutate(request())}
      >
        {plan.isPending ? "Reading instance…" : "Preview changes"}
      </button>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? "New quality profile from a preset" : `Apply a preset to “${name}”`}
      dismissOnBackdrop={false}
      footer={footer}
    >
      {preview ? (
        <PlanPreview result={preview} />
      ) : (
        <div className={styles.chooser}>
          {isNew && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Profile name</span>
              <input
                className={controls.input}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          <div className={styles.presetGrid} role="radiogroup" aria-label="Preset">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === presetId}
                disabled={!p.available}
                className={`${styles.presetTile} ${p.id === presetId ? styles.presetTileActive : ""}`}
                onClick={() => choosePreset(p)}
              >
                <span className={styles.presetName}>
                  {p.name}
                  <span className={styles.presetResolution}>{p.resolution}</span>
                </span>
                <span className={styles.presetSummary}>{p.summary}</span>
                {!p.available && <span className={styles.presetUnavailable}>{p.unavailableReason}</span>}
              </button>
            ))}
          </div>

          {preset && (
            <>
              <p className={styles.presetDescription}>{preset.description}</p>

              <div className={styles.limits}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Size limit, {basisLabel(limit.basisMinutes)}</span>
                  <span className={styles.inputWithUnit}>
                    <input
                      className={controls.input}
                      type="number"
                      min={preset.minimumGb}
                      max={500}
                      step={0.5}
                      value={limit.maxGb}
                      onChange={(e) => setLimit(withMaxGb(limit, Number(e.target.value) || 0, ceilingTouched))}
                    />
                    <span className={styles.unit}>GB</span>
                  </span>
                  {tooSmall && (
                    <span className={styles.fieldError}>
                      At least {preset.minimumGb} GB: anything smaller is below the minimum for this preset's qualities.
                    </span>
                  )}
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <input
                      type="checkbox"
                      className={controls.checkbox}
                      checked={limit.ceilingGb !== null}
                      onChange={(e) => {
                        setCeilingTouched(false);
                        setLimit({ ...limit, ceilingGb: e.target.checked ? defaultCeiling(limit.maxGb) : null });
                      }}
                    />{" "}
                    Hard ceiling per file, this profile only
                  </span>
                  {limit.ceilingGb !== null && (
                    <span className={styles.inputWithUnit}>
                      <input
                        className={controls.input}
                        type="number"
                        min={limit.maxGb}
                        max={999}
                        step={0.5}
                        value={limit.ceilingGb}
                        onChange={(e) => {
                          setCeilingTouched(true);
                          setLimit({ ...limit, ceilingGb: Number(e.target.value) || limit.maxGb });
                        }}
                      />
                      <span className={styles.unit}>GB</span>
                    </span>
                  )}
                </label>
              </div>

              <p className={styles.examples}>
                {sizeExamples(limit)
                  .map((e) => `${formatRuntime(e.minutes)} ≤ ${e.gb} GB`)
                  .join(" · ")}
              </p>
              <p className={styles.hint}>
                The limit scales with runtime and is written to the instance's quality sizes, which every profile on it
                shares. The ceiling is a hard cap for this profile alone.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function PlanPreview({ result }: { result: PlanResult }) {
  const { plan } = result;
  type Step = (typeof plan.steps)[number];
  const created = plan.steps.filter(
    (s): s is Extract<Step, { kind: "customFormat" }> => s.kind === "customFormat" && s.action === "create",
  );
  const rest = plan.steps.filter((s) => !(s.kind === "customFormat" && s.action === "create"));
  return (
    <div className={styles.preview}>
      {plan.warnings.map((w) => (
        <p key={w} className={styles.warning}>
          {w}
        </p>
      ))}

      {plan.steps.length === 0 ? (
        <p className={styles.hint}>
          “{plan.profileName}” already matches this preset. Applying records that Tinkerbell manages it, so changes made
          elsewhere are reported.
        </p>
      ) : (
        <>
          {/* New formats are listed by name: their specs are the library's,
              and seventeen identical-looking tables would bury the two steps
              somebody actually needs to read. Updates keep their diff, because
              those are edits to formats the user already had. */}
          {created.length > 0 && (
            <details className={styles.step}>
              <summary className={styles.stepSummary}>
                Create {created.length} custom format{created.length === 1 ? "" : "s"}
              </summary>
              <p className={styles.createdList}>{created.map((s) => s.name).join(" · ")}</p>
            </details>
          )}
          {rest.map((step) => (
            <details
              key={`${step.kind}:${"name" in step ? step.name : ""}`}
              className={styles.step}
              open={step.kind !== "customFormat"}
            >
              <summary className={styles.stepSummary}>
                {stepHeading(step)}
                <span className={styles.stepCount}>{step.changes.length}</span>
              </summary>
              <table className={styles.changes}>
                <tbody>
                  {step.changes.map((c) => (
                    <tr key={c.path}>
                      <th scope="row">{c.path}</th>
                      <td className={styles.before}>{formatChangeValue(c.before)}</td>
                      <td>{formatChangeValue(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
