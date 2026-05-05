import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import useSwipeBack from "../../../useSwipeBack";
import styles from "../../Jobs.module.css";
import type { Job } from "../types";
import { useJobActions } from "./useJobActions";

interface Props {
  job: Job;
  actions: ReturnType<typeof useJobActions>;
  children: ReactNode;
}

export default function JobPageShell({ job, actions, children }: Props) {
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const { isRunning, latestRun, start, starting, cancel, cancelling } = actions;

  return (
    <div ref={swipeRef} className={styles.jobDetail}>
      <Link to="/jobs" className={styles.backLink}>
        &larr; Back to Jobs
      </Link>

      <div className={styles.jobDetailHeader}>
        <h1 className={styles.heading}>{job.name}</h1>
        <button className={styles.button} disabled={isRunning || starting} onClick={start}>
          {isRunning ? "Running..." : "Run Now"}
        </button>
        {isRunning && latestRun && (
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            onClick={() => cancel(latestRun.id)}
            disabled={cancelling}
          >
            Cancel
          </button>
        )}
      </div>

      {children}
    </div>
  );
}
