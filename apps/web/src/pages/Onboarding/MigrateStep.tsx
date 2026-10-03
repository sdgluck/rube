import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Spinner from "#components/Spinner";
import styles from "./Onboarding.module.css";

/**
 * "Coming from Kometa?", asked at the only moment it's cheap to answer.
 *
 * Placed straight after Plex is connected, and before the rules step, because
 * the ordering is the whole point. Migration used to be reachable only from
 * Settings or a banner on the Rules page — by which time a new admin has
 * already hand-picked a pack of rules, and their imported Kometa rules arrive
 * into a list that already has opinions about the same collections.
 *
 * The step is skippable and self-satisfying: if the scan found nothing to
 * migrate, there's nothing here to do and the step closes itself.
 */
export default function MigrateStep() {
  const statusQuery = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });

  if (statusQuery.isLoading) {
    return (
      <p>
        <Spinner size="xs" /> Looking for collections another tool is managing…
      </p>
    );
  }

  const status = statusQuery.data;
  const total = status?.totalCount ?? 0;
  const completed = status?.providers.some((p) => p.completedAt != null) ?? false;

  if (completed) {
    return (
      <>
        <h2 className={styles.stepTitle}>Already migrated</h2>
        <p>Once the rules match your old setup, you can stop running it.</p>
        <p>
          <Link to="/settings/migrate">Check the migration</Link>
        </p>
      </>
    );
  }

  if (total === 0) {
    return (
      <>
        <h2 className={styles.stepTitle}>Coming from somewhere else?</h2>
        <p>Nothing on this server looks managed by another tool.</p>
        <p>
          <Link to="/settings/migrate">Import a Kometa config anyway →</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className={styles.stepTitle}>Coming from Kometa?</h2>
      <p>
        <strong>{total}</strong> collection{total === 1 ? "" : "s"} on this server look like another tool built{" "}
        {total === 1 ? "it" : "them"}. Each Kometa collection becomes a rule, reviewed before anything reaches Plex.
      </p>
      <p className={styles.notice}>Do this before picking rules, so the two don't compete.</p>
      <p>
        <Link to="/settings/migrate">Import my Kometa config →</Link>
      </p>
    </>
  );
}
