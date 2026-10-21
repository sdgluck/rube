/**
 * Add a feature: pick, configure, review.
 *
 * The list comes from the server's feature catalog rather than a copy kept
 * here — the copy had drifted, which is how Digest came to be impossible to
 * install. Configure renders the same settings form as the feature's own page,
 * so a feature can be set up before its first run instead of installed with
 * defaults and fixed afterwards.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applyConfigPatch, fieldsFor, jobPresentation } from "@rube/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import Modal from "#components/Modal";
import ErrorState from "#components/ErrorState";
import CronPreview from "#components/CronPreview";
import jobStyles from "#pages/Jobs/Jobs.module.css";
import JobSettingsForm, { draftErrors } from "#pages/Jobs/shared/JobSettingsForm";
import ScheduleRow from "#pages/Jobs/shared/rows/ScheduleRow";
import { draftFromConfig, patchFromDraft, type Draft } from "#pages/Jobs/shared/config-draft";
import styles from "./FeatureWizard.module.css";

interface Props {
  onClose: () => void;
}

type Step = "pick" | "configure" | "review";

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "All";
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

export default function FeatureWizard({ onClose }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const catalogQuery = trpc.jobs.featureCatalog.useQuery();
  const installMutation = trpc.jobs.install.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.featureCatalog.invalidate();
    },
  });

  const [step, setStep] = useState<Step>("pick");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [serverError, setServerError] = useState<string>();

  const selected = catalogQuery.data?.find((f) => f.id === selectedId) ?? null;
  const fields = useMemo(() => (selected ? fieldsFor(selected.command) : []), [selected]);
  const errors = draftErrors(fields, draft);
  // Changes from the template, so the review lists only what was customised
  // and the install sends the template's defaults merged with those changes.
  const changes = selected ? patchFromDraft(fields, selected.defaultConfig, draft) : {};

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pick(id: string) {
    const entry = catalogQuery.data?.find((f) => f.id === id);
    if (!entry || entry.installed || entry.locked) return;
    setSelectedId(id);
    setSchedule(entry.defaultSchedule);
    setDraft(draftFromConfig(fieldsFor(entry.command), entry.defaultConfig));
    setServerError(undefined);
    setStep("configure");
  }

  function install() {
    if (!selected) return;
    setServerError(undefined);
    installMutation.mutate(
      {
        featureId: selected.id,
        schedule: schedule.trim(),
        config: applyConfigPatch(selected.defaultConfig, changes),
      },
      {
        onSuccess: () => {
          addToast(`${selected.name} installed`, "success");
          onClose();
          navigate(`/jobs/${selected.id}`);
        },
        onError: (err) => {
          // Back to the step that can fix it, with the server's reason.
          setServerError(err.message);
          setStep("configure");
        },
      },
    );
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
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={Object.keys(errors).length > 0}
                onClick={() => setStep("review")}
              >
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
        {step === "pick" && catalogQuery.error && (
          <ErrorState
            inline
            title="Couldn't load the features"
            error={catalogQuery.error}
            onRetry={() => catalogQuery.refetch()}
          />
        )}
        {step === "pick" && catalogQuery.data && (
          <div className={styles.catalog}>
            {catalogQuery.data.map((entry) => {
              const info = jobPresentation(entry.id);
              const unmet = entry.readiness.filter((r) => !r.met && r.severity === "required");
              const unavailable = entry.installed || entry.locked;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.wizardCard} ${unavailable ? styles.cardDisabled : ""}`}
                  onClick={() => pick(entry.id)}
                  disabled={unavailable}
                >
                  <div className={styles.cardHeader}>
                    <strong>{entry.name}</strong>
                    {entry.installed && <span className={styles.installedTag}>Installed</span>}
                  </div>
                  <p className={styles.cardDesc}>{info.description}</p>
                  {entry.locked ? (
                    <p className={styles.cardRequires}>Turn on Personalized Home Screens first.</p>
                  ) : unmet.length > 0 && !entry.installed ? (
                    <p className={styles.cardRequires}>Still needs: {unmet.map((r) => r.label).join("; ")}.</p>
                  ) : (
                    info.requires && <p className={styles.cardRequires}>Requires: {info.requires}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {step === "configure" && selected && (
          <div className={styles.form}>
            <h3>{selected.name}</h3>
            <table className={jobStyles.configTable}>
              <tbody>
                <ScheduleRow value={schedule} onChange={setSchedule} />
                <JobSettingsForm fields={fields} draft={draft} onChange={setDraft} errors={errors} />
              </tbody>
            </table>
            {serverError && (
              <p role="alert" className={jobStyles.fieldHelpError}>
                {serverError}
              </p>
            )}
          </div>
        )}

        {step === "review" && selected && (
          <div className={styles.form}>
            <h3>Install {selected.name}</h3>
            <p className={styles.muted}>{jobPresentation(selected.id).description}</p>
            <dl className={styles.summary}>
              <dt>Schedule</dt>
              <dd>{schedule.trim() ? <CronPreview expr={schedule.trim()} /> : "Manual / on demand"}</dd>
              {fields
                .filter((f) => f.key in changes)
                .map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{describeValue(draft[f.key])}</dd>
                  </div>
                ))}
            </dl>
            {Object.keys(changes).length === 0 && <p className={styles.muted}>Every other setting at its default.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
