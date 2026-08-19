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
        <p className={styles.stepLede}>
          You've brought a configuration across. Once you're happy the rules do what your old setup did, you can stop
          running it.
        </p>
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
        <p className={styles.stepLede}>
          Tinkerbell can read a Kometa config and turn each collection definition into a rule. Nothing on this server
          looks like it's managed by another tool, so there's probably nothing to bring across — skip this step.
        </p>
        <p>
          If you do have a Kometa config, <Link to="/settings/migrate">import it here</Link>.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className={styles.stepTitle}>Coming from Kometa?</h2>
      <p className={styles.stepLede}>
        <strong>{total}</strong> collection{total === 1 ? "" : "s"} on this server look like another tool built{" "}
        {total === 1 ? "it" : "them"}.
      </p>
      <p>
        Give Tinkerbell your Kometa config and it will turn each collection definition into a rule — carrying across
        filters, limits, schedules and posters, and telling you exactly what it couldn't. Nothing is written to Plex
        until you've reviewed it.
      </p>
      <p className={styles.notice}>
        Worth doing before you pick rules below, so your own collections don't end up competing with a starter pack.
      </p>
      <p>
        <Link to="/settings/migrate">Import my Kometa config →</Link>
      </p>
    </>
  );
}
