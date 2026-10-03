import type React from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import styles from "./Stats.module.css";

/**
 * A panel with nothing to show yet, and — when the gap is watch history —
 * the button that fills it.
 *
 * Four panels used to end their empty state with "run Import Plex Watch
 * History from Jobs", which is directions to a button on another page. The
 * button is here instead.
 */
export default function PanelEmpty({
  children,
  importHistory,
}: {
  children: React.ReactNode;
  importHistory?: boolean;
}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const start = trpc.jobs.start.useMutation();
  return (
    <div className={styles.panelEmpty}>
      <span>{children}</span>
      {importHistory && (
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { jobId: "playback-backfill" },
              {
                onSuccess: ({ runId }) => navigate(`/jobs/runs/${runId}`),
                onError: (err) => addToast(err.message, "error"),
              },
            )
          }
        >
          Import from Plex
        </button>
      )}
    </div>
  );
}
