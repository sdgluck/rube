/**
 * "Run now", plus a caret for the job's one-off variants when it has any.
 *
 * Variants come from contracts and are filtered to ones that would change
 * something for this job as configured, so the menu never offers what the main
 * button already does. Destructive ones confirm first.
 */
import { useState } from "react";
import { variantsForJob, type VariantSpec } from "@tinkerbell/contracts";
import DropdownButton from "#components/DropdownButton";
import ConfirmModal from "#components/ConfirmModal";
import styles from "#pages/Jobs/Jobs.module.css";
import type { Job } from "#pages/Jobs/types";

interface Props {
  job: Job;
  isRunning: boolean;
  starting: boolean;
  start: (variant?: string) => void;
}

export default function RunButton({ job, isRunning, starting, start }: Props) {
  const [confirming, setConfirming] = useState<VariantSpec | null>(null);
  const variants = variantsForJob(job.id, job.command, (job.config ?? {}) as Record<string, unknown>);
  const disabled = isRunning || starting;
  const label = isRunning ? "Running…" : "Run Now";

  if (variants.length === 0) {
    return (
      <button className={styles.button} disabled={disabled} onClick={() => start()}>
        {label}
      </button>
    );
  }

  return (
    <div className={styles.splitGroup}>
      <button className={styles.splitMain} disabled={disabled} onClick={() => start()}>
        {label}
      </button>
      <DropdownButton
        label=""
        ariaLabel="Other ways to run"
        className={styles.splitCaret}
        disabled={disabled}
        options={variants.map((v) => ({
          label: v.label,
          title: v.description,
          danger: v.confirm?.danger,
          onClick: () => (v.confirm ? setConfirming(v) : start(v.id)),
        }))}
      />
      {confirming?.confirm && (
        <ConfirmModal
          title={confirming.confirm.title}
          message={confirming.confirm.message}
          confirmLabel={confirming.label}
          danger={confirming.confirm.danger}
          onConfirm={() => {
            start(confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
