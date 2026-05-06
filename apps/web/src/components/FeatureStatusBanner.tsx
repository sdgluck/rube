import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import styles from "#pages/Jobs/Jobs.module.css";

interface Props {
  /** Job id of the feature (e.g. "overlays", "because-you-watched"). */
  featureId: string;
}

/**
 * Informational banner shown on pages whose effects depend on a Jobs feature
 * being enabled. Surfaces the current state and links to the feature page.
 * Does NOT gate interaction — users can still author/preview when off.
 */
export default function FeatureStatusBanner({ featureId }: Props) {
  const jobsQuery = trpc.jobs.list.useQuery();
  const job = jobsQuery.data?.find((j) => j.id === featureId);
  if (!job) return null;

  const enabled = !!job.enabled;
  return (
    <div className={styles.featureBanner}>
      <span>
        <span className={styles.featureBannerStatus} data-enabled={enabled ? "true" : "false"}>
          <span className={styles.statusDot} data-status={enabled ? "completed" : "cancelled"} />
          {job.name} is {enabled ? "enabled" : "disabled"}
        </span>
        {!enabled && " — changes here won't take effect until you enable the feature."}
      </span>
      <Link to={`/jobs/${job.id}`} className={styles.featureBannerLink}>
        Open feature →
      </Link>
    </div>
  );
}
