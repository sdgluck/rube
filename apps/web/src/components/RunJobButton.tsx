import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";

/**
 * Start a job and follow it to its run page.
 *
 * Empty states used to end in "run Sync Radarr & Sonarr from Jobs" — directions
 * to a button on another page. This is that button, wherever the gap shows.
 * Following the run rather than toasting means the person sees the outcome,
 * not just the fact that something started.
 */
export default function RunJobButton({
  jobId,
  children,
  variant = "secondary",
  small = false,
}: {
  /** An id from `DEFAULT_JOBS` in packages/jobs/src/runner.ts. */
  jobId: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  small?: boolean;
}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const start = trpc.jobs.start.useMutation();
  const className = [
    controls.btn,
    variant === "primary" ? controls.btnPrimary : controls.btnSecondary,
    small ? controls.btnSm : "",
  ].join(" ");
  return (
    <button
      type="button"
      className={className}
      disabled={start.isPending}
      onClick={() =>
        start.mutate(
          { jobId },
          {
            onSuccess: ({ runId }) => navigate(`/jobs/runs/${runId}`),
            onError: (err) => addToast(err.message, "error"),
          },
        )
      }
    >
      {children}
    </button>
  );
}
