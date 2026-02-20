import { useState } from "react";
import { trpc } from "../trpc";
import styles from "./Events.module.css";

const BADGE_MAP: Record<string, { label: string; className: string }> = {
  "job.completed": { label: "Job Completed", className: styles.badgeJobCompleted },
  "job.failed": { label: "Job Failed", className: styles.badgeJobFailed },
  "health.failed": { label: "Health Failed", className: styles.badgeHealthFailed },
  "health.recovered": { label: "Health Recovered", className: styles.badgeHealthRecovered },
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function Events() {
  const [limit, setLimit] = useState(50);

  const query = trpc.events.list.useQuery(
    { limit, offset: 0 },
    { refetchInterval: 10000, refetchOnWindowFocus: false },
  );

  const events = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = events.length < total;

  return (
    <div>
      <h2 className={styles.heading}>Events</h2>

      {events.length === 0 && !query.isLoading ? (
        <div className={styles.empty}>No events yet</div>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const badge = BADGE_MAP[event.type] ?? {
                  label: event.type,
                  className: styles.badgeDefault,
                };
                return (
                  <tr key={event.id}>
                    <td className={styles.timestamp}>{formatTimestamp(event.timestamp)}</td>
                    <td>
                      <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td>{event.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hasMore && (
            <div className={styles.loadMore}>
              <button className={styles.button} onClick={() => setLimit((l) => l + 50)}>
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
