import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import CardSection from "#components/CardSection";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
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
    title: "Clear Rube Labels",
    description: "Removes Rube labels from every item and collection; sharing is unaffected.",
    confirmMessage: "Removes the Rube label from every item in your configured Plex libraries.",
    confirmLabel: "Clear labels",
  },
  {
    jobId: "overlays-remove",
    title: "Remove Overlays",
    description: "Restores original posters; run before disabling Overlays to undo them.",
    confirmMessage: "Restores the original poster on every item with an overlay.",
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
    <div className={settings.form}>
      <SettingsPageHeader title="Maintenance" />

      {jobsQuery.error && (
        <ErrorState
          inline
          title="Couldn't load maintenance job status"
          error={jobsQuery.error}
          onRetry={() => jobsQuery.refetch()}
        />
      )}

      {ACTIONS.map((action) => {
        const job = jobsQuery.data?.find((j) => j.id === action.jobId);
        const lastRun = job?.lastRunStartedAt;
        const running = job?.lastRunStatus === "running";
        return (
          <CardSection
            key={action.jobId}
            className={settings.group}
            titleClassName={settings.groupTitle}
            title={action.title}
          >
            <p className={settings.hint}>{action.description}</p>
            {lastRun && (
              <p className={local.actionMeta}>
                Last run <RelativeTime timestamp={lastRun} />
                {job?.lastRunStatus ? ` — ${job.lastRunStatus}` : ""}
              </p>
            )}
            <div className={settings.buttons}>
              <button
                type="button"
                className={settings.buttonSecondary}
                onClick={() => setPending(action)}
                disabled={startMutation.isPending || running}
              >
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </CardSection>
        );
      })}

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
