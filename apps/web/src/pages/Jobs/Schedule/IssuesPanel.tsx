import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ScheduleFix, ScheduleIssue, ScheduleSeverity } from "@tinkerbell/contracts";
import controls from "#/styles/controls.module.css";
import styles from "./Schedule.module.css";

const ICON: Record<ScheduleSeverity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE: Record<ScheduleSeverity, string> = {
  error: styles.issueError,
  warning: styles.issueWarning,
  info: styles.issueInfo,
};

/**
 * Every problem with the draft, worst first, each with the change that fixes
 * it. A fix edits the draft like a drag would — it is undoable and nothing is
 * saved until Save — so offering it costs the user nothing to try.
 */
export default function IssuesPanel({
  issues,
  onFix,
  onFocus,
}: {
  issues: ScheduleIssue[];
  onFix: (fix: ScheduleFix) => void;
  onFocus: (issue: ScheduleIssue) => void;
}) {
  if (issues.length === 0) {
    return (
      <p className={styles.allClear}>
        <CheckCircle2 size="1.6rem" aria-hidden="true" /> No problems — every job runs after what it depends on, inside
        the window, without queueing behind another.
      </p>
    );
  }
  return (
    <ul className={styles.issues}>
      {issues.map((issue) => {
        const Icon = ICON[issue.severity];
        return (
          <li key={issue.key} className={`${styles.issue} ${TONE[issue.severity]}`}>
            <Icon size="1.5rem" className={styles.issueIcon} aria-label={issue.severity} />
            <div className={styles.issueBody}>
              <button
                type="button"
                className={styles.issueText}
                onClick={() => onFocus(issue)}
                disabled={issue.jobIds.length === 0}
              >
                {issue.message}
                {issue.blocking && <span className={styles.blockingTag}>Blocks saving</span>}
              </button>
              {issue.fixes.length > 0 && (
                <div className={styles.issueFixes}>
                  {issue.fixes.map((fix) => (
                    <button
                      key={fix.label}
                      type="button"
                      className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                      onClick={() => onFix(fix)}
                    >
                      {fix.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
