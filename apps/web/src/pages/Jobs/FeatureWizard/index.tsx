import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { describeCron } from "#/utils";
import { FEATURE_CATALOG, type FeatureCatalogEntry } from "./feature-catalog";
import Modal from "#components/Modal";
import ErrorState from "#components/ErrorState";
import styles from "./FeatureWizard.module.css";

interface Props {
  onClose: () => void;
}

type Step = "pick" | "configure" | "review";

export default function FeatureWizard({ onClose }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery();
  const installMutation = trpc.jobs.install.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<FeatureCatalogEntry | null>(null);
  const [schedule, setSchedule] = useState("");

  const installedIds = new Set((jobsQuery.data ?? []).map((j) => j.id));

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pick(entry: FeatureCatalogEntry) {
    if (installedIds.has(entry.id)) return;
    setSelected(entry);
    setSchedule(entry.defaultSchedule);
    setStep("configure");
  }

  function install() {
    if (!selected) return;
    installMutation.mutate(
      { featureId: selected.id, schedule },
      {
        onSuccess: () => {
          addToast(`${selected.name} installed`, "success");
          onClose();
          navigate(`/jobs/${selected.id}`);
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  let scheduleHint: string | null = null;
  if (schedule) {
    try {
      scheduleHint = describeCron(schedule);
    } catch {
      scheduleHint = "Invalid cron expression";
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a feature"
      size="lg"
      footer={
        <>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <div className={styles.footerSpacer} />
          {step === "configure" && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setStep("pick")}>
                Back
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => setStep("review")}>
                Continue
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setStep("configure")}>
                Back
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={installMutation.isPending}
                onClick={install}
              >
                {installMutation.isPending ? "Installing…" : "Install"}
              </button>
            </>
          )}
        </>
      }
    >
      <div className={styles.steps} aria-hidden="true">
        <span className={step === "pick" ? styles.stepActive : styles.step}>1. Pick</span>
        <span className={step === "configure" ? styles.stepActive : styles.step}>2. Configure</span>
        <span className={step === "review" ? styles.stepActive : styles.step}>3. Review</span>
      </div>

      <div className={styles.body}>
        {step === "pick" && jobsQuery.error && (
          <ErrorState
            inline
            title="Couldn't check which features are installed"
            error={jobsQuery.error}
            onRetry={() => jobsQuery.refetch()}
          />
        )}
        {step === "pick" && !jobsQuery.error && (
          <div className={styles.catalog}>
            {FEATURE_CATALOG.map((entry) => {
              const already = installedIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.card} ${already ? styles.cardDisabled : ""}`}
                  onClick={() => pick(entry)}
                  disabled={already}
                >
                  <div className={styles.cardHeader}>
                    <strong>{entry.name}</strong>
                    {already && <span className={styles.installedTag}>Installed</span>}
                  </div>
                  <p className={styles.cardDesc}>{entry.description}</p>
                  {entry.requires && <p className={styles.cardRequires}>Requires: {entry.requires}</p>}
                </button>
              );
            })}
          </div>
        )}

        {step === "configure" && selected && (
          <div className={styles.form}>
            <h3>{selected.name}</h3>
            <p className={styles.muted}>
              You can fine-tune sections, limits and other options on the feature's page after installing.
            </p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Schedule (cron)</span>
              <input
                type="text"
                className={styles.input}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="e.g. 0 2 * * *"
              />
              {scheduleHint && <span className={styles.fieldHint}>{scheduleHint}</span>}
              {!schedule && <span className={styles.fieldHint}>No schedule — runs only on demand.</span>}
            </label>
          </div>
        )}

        {step === "review" && selected && (
          <div className={styles.form}>
            <h3>Install {selected.name}</h3>
            <p className={styles.muted}>{selected.description}</p>
            <dl className={styles.summary}>
              <dt>Schedule</dt>
              <dd>{schedule ? `${schedule} — ${scheduleHint}` : "Manual / on demand"}</dd>
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}
