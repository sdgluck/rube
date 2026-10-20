import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import ConfirmModal from "#components/ConfirmModal";
import { PageCrumbs } from "#layout/AppBar";
import { useToast } from "#components/Toast";
import styles from "#pages/Jobs/Jobs.module.css";
import type { Job } from "#pages/Jobs/types";
import { isFeatureId } from "@tinkerbell/contracts";
import { jobUi } from "#pages/Jobs/presentation";
import { useJobActions } from "./useJobActions";
import CheckpointNotice from "./CheckpointNotice";
import RunButton from "./RunButton";
import ReadinessPanel from "./ReadinessPanel";
import { formatElapsed } from "#/format";

interface Props {
  job: Job;
  actions: ReturnType<typeof useJobActions>;
  children: ReactNode;
}

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * What removing a feature takes with it, where that is more than its config.
 * A map rather than the nested ternary it was: eight features deep, the
 * ternary was the one place a new feature's wording could go missing unseen.
 */
const REMOVE_MESSAGES: Record<string, string> = {
  "because-you-watched":
    "Deletes its config, run history and every Because You Watched collection from Plex, and clears shared users' restrictions. Item labels stay — clear them in Settings › Maintenance.",
  "we-think-youd-like":
    "Deletes its config, run history and every We Think You'd Like collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "pick-it-back-up":
    "Deletes its config, run history and every Pick It Back Up collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "finish-the-franchise":
    "Deletes its config, run history and every Finish the Franchise collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "watch-it-again":
    "Deletes its config, run history and every Watch It Again collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "new-for-you":
    "Deletes its config, run history and every New For You collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "more-from":
    "Deletes its config, run history and every More From… collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "requests-arrived":
    "Deletes its config, run history and every Your Requests Are Here collection from Plex. Sharing restrictions stay with Personalized Home Screens.",
  "season-collections":
    "Deletes its config, its seasons, run history and every Season Collections collection from Plex.",
  "leaving-soon":
    "Deletes its config, run history and every Leaving Soon collection from Plex. What cleanup removes is unchanged.",
};

export default function JobPageShell({ job, actions, children }: Props) {
  const navigate = useNavigate();
  const { isRunning, latestRun, start, starting, cancel, cancelling } = actions;
  const fields = jobUi(job);
  const description = fields.description;
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const uninstallMutation = trpc.jobs.uninstall.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      addToast(`${job.name} removed`, "success");
      navigate("/jobs");
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const status = job.lastRunStatus;
  const lastDuration =
    latestRun && latestRun.status !== "running" ? formatElapsed(latestRun.startedAt, latestRun.finishedAt) : null;

  return (
    <div className={styles.jobDetail}>
      <PageCrumbs crumbs={[{ label: job.name }]} />

      <div className={styles.jobDetailHeader}>
        <div className={styles.jobDetailHeading}>
          {status && (
            <span className={styles.statusPill} data-status={status}>
              <span className={styles.statusDot} data-status={status} />
              <span>{STATUS_LABELS[status] ?? status}</span>
              {job.lastRunStartedAt && (
                <span className={styles.statusPillMeta}>
                  · <RelativeTime timestamp={job.lastRunStartedAt} />
                </span>
              )}
              {lastDuration && <span className={styles.statusPillMeta}>· {lastDuration}</span>}
            </span>
          )}
          {fields.enabled === "required" &&
            (job.enabled ? (
              <span className={styles.alwaysOnPill}>Always on</span>
            ) : (
              <span className={styles.alwaysOnPill} data-state="off" title="Switched off — this job is not running">
                Always on — currently off
              </span>
            ))}
        </div>
        <div className={styles.jobDetailActions}>
          {/* By id, not by kind: only an installed template can be uninstalled,
              and an id the server doesn't know would only throw. */}
          {isFeatureId(job.id) && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              onClick={() => setConfirmRemove(true)}
              disabled={uninstallMutation.isPending}
            >
              Remove
            </button>
          )}
          {isRunning && latestRun && (
            <button
              className={`${styles.button} ${styles.buttonDanger}`}
              onClick={() => cancel(latestRun.id)}
              disabled={cancelling}
            >
              Cancel
            </button>
          )}
          <RunButton job={job} isRunning={isRunning} starting={starting} start={start} />
        </div>
      </div>

      {description && (
        <p className={styles.jobDescription}>
          {description}
          {fields.settingsHref && (
            <>
              {" "}
              Related settings: <Link to={fields.settingsHref}>{fields.settingsLabel ?? "Settings"}</Link>.
            </>
          )}
        </p>
      )}

      {/* In the shell rather than per job page: which commands checkpoint is
          the runner's business, and the notice renders nothing for the ones
          that don't. */}
      <ReadinessPanel jobId={job.id} alwaysShow={fields.kind === "feature"} />

      <CheckpointNotice jobId={job.id} />

      {children}

      {confirmRemove && (
        <ConfirmModal
          message={REMOVE_MESSAGES[job.id] ?? "Deletes its config and run history. It can be re-installed later."}
          title={`Remove ${job.name}?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            setConfirmRemove(false);
            uninstallMutation.mutate({ featureId: job.id });
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
