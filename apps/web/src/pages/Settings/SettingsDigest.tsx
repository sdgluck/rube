import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import shared from "#/styles/shared.module.css";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./SettingsDigest.module.css";

/**
 * The digest's oversight page.
 *
 * Deliberately not a settings form. The schedule lives on the Digest job, the
 * routing lives in each notification service's event list, and the recipients
 * are set by the users themselves in the portal — duplicating any of those
 * here would create a second place to change them and a way for the two to
 * disagree. What is genuinely missing elsewhere is *seeing*: what a digest
 * would say, who has asked for one, and whether the last ones arrived.
 *
 * The preview is the part that matters. Nobody should first see their
 * newsletter in a friend's inbox.
 */
export default function SettingsDigest() {
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  // Empty = the server-wide digest, which is the one the admin's own channels
  // receive and therefore the sensible thing to open on.
  const [userId, setUserId] = useState<string>("");

  const emailStatusQuery = trpc.digest.emailStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const subscribersQuery = trpc.digest.subscribers.useQuery(undefined, { refetchOnWindowFocus: false });
  const deliveriesQuery = trpc.digest.deliveries.useQuery({ limit: 20 }, { refetchOnWindowFocus: false });
  const previewQuery = trpc.digest.preview.useQuery(
    { frequency, userId: userId === "" ? undefined : Number(userId) },
    { refetchOnWindowFocus: false },
  );

  const subscribers = subscribersQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];
  const preview = previewQuery.data;

  return (
    <>
      <SettingsPageHeader title="Digest" />

      <p className={styles.intro}>
        A periodic summary of what was added, what people watched, and anything about to be removed. It goes to
        whichever notification services you've ticked <strong>Digest</strong> for, and by email to portal users who
        asked for one. Its schedule is on the <Link to="/jobs/digest">Digest job</Link>; who receives it is set per
        service under <Link to="/settings/notifications">Notifications</Link>.
      </p>

      {emailStatusQuery.data && !emailStatusQuery.data.smtpConfigured && (
        <p className={styles.notice}>
          Email isn't configured, so per-user digests won't be sent. Set up a mail server under{" "}
          <Link to="/settings/notifications/smtp">Notifications → Email</Link>. The server-wide digest still goes to
          your other channels.
        </p>
      )}

      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Period</span>
          <select
            className={shared.select}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")}
          >
            <option value="weekly">Last 7 days</option>
            <option value="monthly">Last 30 days</option>
          </select>
        </label>

        <label className={styles.control}>
          <span>As seen by</span>
          <select className={shared.select} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone (server-wide)</option>
            {subscribers.map((s) => (
              <option key={s.userId} value={String(s.userId)}>
                {s.username}
              </option>
            ))}
          </select>
        </label>
      </div>

      {previewQuery.isLoading && <p className={styles.empty}>Building the preview…</p>}
      {previewQuery.error && <p className={styles.empty}>Couldn't build a preview: {previewQuery.error.message}</p>}

      {preview && (
        <div className={styles.preview}>
          <h2 className={styles.previewTitle}>{preview.message.title}</h2>
          <p className={styles.previewText}>{preview.message.text}</p>
          {(preview.message.blocks ?? []).length === 0 ? (
            <p className={styles.empty}>
              Nothing happened in this period, so no digest would be sent — the run would record it as skipped rather
              than mail out an empty summary.
            </p>
          ) : (
            (preview.message.blocks ?? []).map((block) => (
              <div key={block.heading} className={styles.block}>
                <p className={styles.blockHeading}>{block.heading}</p>
                <ul className={styles.blockLines}>
                  {block.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      <div className={styles.field} style={{ marginTop: 28 }}>
        <label>Subscribers</label>
        {subscribers.length === 0 ? (
          <span className={styles.hint}>
            Nobody has subscribed yet. Portal users choose a frequency and enter their own address — Tinkerbell never
            takes an address from Plex.
          </span>
        ) : (
          <table className={`${shared.table} ${styles.table}`}>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Frequency</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.userId}>
                  <td>{s.username}</td>
                  <td>{s.email}</td>
                  <td>{s.frequency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.field}>
        <label>Recent deliveries</label>
        {deliveries.length === 0 ? (
          <span className={styles.hint}>Nothing has been sent yet.</span>
        ) : (
          <table className={`${shared.table} ${styles.table}`}>
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Items</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td>
                    <RelativeTime timestamp={d.sentAt} />
                  </td>
                  <td>{d.channel}</td>
                  <td>
                    {d.userId === 0 ? "Server-wide" : (subscriberName(subscribers, d.userId) ?? `User ${d.userId}`)}
                  </td>
                  <td>{d.itemCount}</td>
                  <td className={outcomeClass(d.status)}>
                    {d.status === "skipped_empty" ? "nothing to send" : d.status}
                    {d.error && <span className={styles.hint}>{d.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function subscriberName(subscribers: Array<{ userId: number; username: string }>, userId: number): string | undefined {
  return subscribers.find((s) => s.userId === userId)?.username;
}

function outcomeClass(status: string): string | undefined {
  if (status === "failed") return styles.statusFailed;
  if (status === "skipped_empty") return styles.statusSkipped;
  return undefined;
}
