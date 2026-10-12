import RelativeTime from "#components/RelativeTime";
import styles from "./Problems.module.css";

/** When episodes were last compared with Sonarr — the one check that isn't live. */
export function ScannedLine({ lastScannedAt }: { lastScannedAt: number | null }) {
  return (
    <p className={styles.scanned}>
      {lastScannedAt ? (
        <>
          Episodes last compared <RelativeTime timestamp={lastScannedAt} />. Everything else is checked as you open this
          page.
        </>
      ) : (
        <>Episodes haven't been compared with Sonarr yet. The scan runs nightly, or now with Scan now.</>
      )}
    </p>
  );
}
