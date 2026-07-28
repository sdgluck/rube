import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import styles from "./FeatureStatusBanner.module.css";

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
    <Banner
      variant={enabled ? "ok" : "warn"}
      dot
      actions={
        <Link to={`/jobs/${job.id}`} className={styles.link}>
          Open feature
        </Link>
      }
    >
      <strong>
        {job.name} is {enabled ? "enabled" : "disabled"}
      </strong>
      {!enabled && " — changes here won't take effect until you enable the feature."}
    </Banner>
  );
}
