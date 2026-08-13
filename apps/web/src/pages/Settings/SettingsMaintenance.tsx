import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import SettingsPageHeader from "./SettingsPageHeader";
import local from "./SettingsMaintenance.module.css";
import ErrorState from "#components/ErrorState";

interface MaintenanceAction {
  jobId: string;
  title: string;
  description: string;
  confirmMessage: string;
  confirmLabel: string;
}

const ACTIONS: MaintenanceAction[] = [
  {
    jobId: "label-undo",
    title: "Clear Tinkerbell Labels",
    description:
      "Remove the Tinkerbell label from every item in your Plex libraries and strip per-user labels from collections. Does not change which users see what — sharing restrictions are managed by the Because You Watched lifecycle.",
    confirmMessage:
      "This will remove the Tinkerbell label from every item in your configured Plex libraries. Sharing restrictions are NOT affected. Continue?",
    confirmLabel: "Clear labels",
  },
  {
    jobId: "overlays-remove",
    title: "Remove Overlays",
    description:
      "Restore original poster artwork by removing overlays previously applied. Use this before disabling the Overlays feature if you want to undo its effects.",
    confirmMessage: "This will restore original poster artwork on every overlay-affected item. Continue?",
    confirmLabel: "Remove overlays",
  },
];

export default function SettingsMaintenance() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const jobsQuery = trpc.jobs.list.useQuery();
  const startMutation = trpc.jobs.start.useMutation();
  const [pending, setPending] = useState<MaintenanceAction | null>(null);

  function trigger(action: MaintenanceAction) {
    startMutation.mutate(
      { jobId: action.jobId },
      {
        onSuccess: ({ runId }) => {
          addToast(`${action.title} started`, "success");
          navigate(`/jobs/runs/${runId}`);
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
    setPending(null);
  }

  return (
    <div>
      <SettingsPageHeader title="Maintenance" />

      {jobsQuery.error && (
        <ErrorState
          inline
          title="Couldn't load maintenance job status"
          error={jobsQuery.error}
          onRetry={() => jobsQuery.refetch()}
        />
      )}

      <div className={local.actionList}>
        {ACTIONS.map((action) => {
          const job = jobsQuery.data?.find((j) => j.id === action.jobId);
          const lastRun = job?.lastRunStartedAt;
          return (
            <div key={action.jobId} className={local.actionCard}>
              <div className={local.actionRow}>
                <div className={local.actionText}>
                  <strong>{action.title}</strong>
                  <span className={local.actionDescription}>{action.description}</span>
                  {lastRun && (
                    <span className={local.actionMeta}>
                      Last run <RelativeTime timestamp={lastRun} />
                      {job?.lastRunStatus ? ` — ${job.lastRunStatus}` : ""}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPending(action)}
                  disabled={startMutation.isPending || job?.lastRunStatus === "running"}
                >
                  {job?.lastRunStatus === "running" ? "Running…" : "Run"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {pending && (
        <ConfirmModal
          title={pending.confirmLabel}
          message={pending.confirmMessage}
          confirmLabel={pending.confirmLabel}
          danger
          onConfirm={() => trigger(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
