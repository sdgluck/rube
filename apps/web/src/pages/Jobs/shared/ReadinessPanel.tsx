/**
 * "What this needs": the job's prerequisites that live on other pages, each
 * marked met or not, with a link to where it's set.
 *
 * Always shown for features — they're opt-in, so whether they can work is the
 * first question. For system jobs it appears only when something is missing,
 * so a healthy install's job pages aren't padded with a list of ticks.
 */
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import styles from "#pages/Jobs/Jobs.module.css";

export default function ReadinessPanel({ jobId, alwaysShow }: { jobId: string; alwaysShow: boolean }) {
  const query = trpc.jobs.readiness.useQuery({ jobId }, { refetchOnWindowFocus: true });
  const items = query.data?.items ?? [];
  const missing = items.filter((i) => !i.met);
  const blocking = missing.filter((i) => i.severity === "required");
  if (items.length === 0 || (!alwaysShow && missing.length === 0)) return null;

  if (missing.length === 0) {
    return (
      <p className={styles.readinessAllSet}>
        <span className={styles.readinessDot} data-state="met" aria-hidden="true" />
        Everything this needs is set up.
      </p>
    );
  }

  return (
    <CardSection
      className={styles.readinessCard}
      titleClassName={styles.detailSectionTitle}
      title={blocking.length > 0 ? "What this needs" : "Recommended"}
    >
      <ul className={styles.readinessList}>
        {items.map((item) => (
          <li key={item.id} className={styles.readinessItem}>
            <span
              className={styles.readinessDot}
              data-state={item.met ? "met" : item.severity === "required" ? "missing" : "recommended"}
              aria-label={item.met ? "Done" : "Missing"}
            />
            <span>
              {item.href && !item.met ? <Link to={item.href}>{item.label}</Link> : item.label}
              {item.detail && <span className={styles.readinessDetail}> — {item.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}
