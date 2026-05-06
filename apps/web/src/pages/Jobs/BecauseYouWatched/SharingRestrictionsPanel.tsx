import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import styles from "#pages/Jobs/Jobs.module.css";
import { getMembersOf } from "#pages/Jobs/groups";

export default function SharingRestrictionsPanel() {
  const jobsQuery = trpc.jobs.list.useQuery();
  const memberIds = getMembersOf("because-you-watched").map((m) => m.id);
  const members = (jobsQuery.data ?? []).filter((j) => memberIds.includes(j.id));

  if (members.length === 0) return null;

  return (
    <fieldset className={styles.detailSection}>
      <legend className={styles.detailSectionTitle}>Sharing Restrictions</legend>
      <p className={styles.jobDescription} style={{ margin: 0 }}>
        Plex sharing restrictions gate which Because You Watched collections each user can see. Apply them after
        enabling Because You Watched; clear them if you turn the feature off.
      </p>
      <div className={styles.sharingPanel}>
        {members.map((job) => {
          const status = job.lastRunStatus;
          const startedAt = job.lastRunStartedAt;
          return (
            <Link key={job.id} to={`/jobs/${job.id}`} className={styles.sharingRow}>
              <div className={styles.sharingRowMeta}>
                <span className={styles.sharingRowTitle}>{job.name}</span>
                <span className={styles.sharingRowDetail}>
                  {startedAt ? (
                    <>
                      Last run <RelativeTime timestamp={startedAt} />
                      {status ? ` — ${status}` : ""}
                    </>
                  ) : (
                    "Never run"
                  )}
                </span>
              </div>
              <span className={styles.jobNoticeLink}>Open →</span>
            </Link>
          );
        })}
      </div>
    </fieldset>
  );
}
