import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import styles from "./Onboarding.module.css";

const NEXT_LINKS = [
  { to: "/collections", label: "Collections", blurb: "What your rules have built, once they've run." },
  { to: "/jobs", label: "Jobs", blurb: "Every scheduled task, its cron, and its run history." },
  { to: "/settings/health", label: "Health", blurb: "Whether each connected service is still answering." },
];

export default function DoneStep() {
  const healthQuery = trpc.health.status.useQuery();
  const rulesQuery = trpc.rules.list.useQuery();

  const connected = (healthQuery.data ?? []).filter((s) => s.configured);
  const rules = rulesQuery.data ?? [];
  const enabled = rules.filter((r) => r.enabled);

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>You're set up</h2>
      <ul className={styles.summary}>
        <li>
          <strong>{connected.length}</strong> service{connected.length === 1 ? "" : "s"} connected
          {connected.length > 0 && (
            <span className={styles.summaryDetail}>{connected.map((s) => s.service).join(", ")}</span>
          )}
        </li>
        <li>
          <strong>{rules.length}</strong> rule{rules.length === 1 ? "" : "s"}, <strong>{enabled.length}</strong> enabled
          {enabled.length === 0 && rules.length > 0 && (
            <span className={styles.summaryDetail}>
              Nothing will run until you enable at least one — <Link to="/rules">Rules</Link>.
            </span>
          )}
        </li>
      </ul>

      <h3 className={styles.groupHeading}>Where to go next</h3>
      <div className={styles.tileGrid}>
        {NEXT_LINKS.map((link) => (
          <Link key={link.to} to={link.to} className={`${styles.tile} ${styles.tileClickable}`}>
            <span className={styles.tileTitle}>{link.label}</span>
            <span className={styles.tileBlurb}>{link.blurb}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
