import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import shared from "#/styles/shared.module.css";
import CardSection from "#components/CardSection";
import CronPreview from "#components/CronPreview";
import SettingsPageLink from "#components/SettingsPageLink";
import { useToast } from "#components/Toast";
import { DIGEST_DEFAULTS } from "@tinkerbell/contracts";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
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

  // The Digest job: whether it's installed, when it runs, and what it still
  // needs. Shown here because this is where people come looking for "is my
  // digest on?" — the settings themselves stay on the job's page.
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const digestJob = jobsQuery.data?.find((j) => j.id === "digest");
  const readinessQuery = trpc.jobs.readiness.useQuery({ jobId: "digest" }, { enabled: !!digestJob });
  const unmet = (readinessQuery.data?.items ?? []).filter((i) => !i.met && i.severity === "required");
  const installMutation = trpc.jobs.install.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      addToast("Digest installed", "success");
    },
    onError: (err) => addToast(err.message, "error"),
  });
  const digestConfig = (digestJob?.config ?? {}) as { frequency?: string };

  const subscribers = subscribersQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];
  const preview = previewQuery.data;

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Digest" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Digest job">
        {!jobsQuery.data ? null : !digestJob ? (
          <>
            <p className={settings.readout}>Not installed — nothing is sent.</p>
            <div>
              <button
                type="button"
                className={settings.button}
                disabled={installMutation.isPending}
                onClick={() => installMutation.mutate({ featureId: "digest" })}
              >
                {installMutation.isPending ? "Installing…" : "Install Digest"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={settings.readout}>
              {digestJob.enabled ? "On" : "Switched off"} · covers{" "}
              {(digestConfig.frequency ?? DIGEST_DEFAULTS.frequency) === "monthly" ? "the past month" : "the past week"}
              {unmet.length > 0 && ` · still needs: ${unmet.map((i) => i.label.toLowerCase()).join("; ")}`}
            </p>
            {digestJob.schedule ? (
              <CronPreview expr={digestJob.schedule} />
            ) : (
              <p className={settings.readout}>No schedule — runs only when started.</p>
            )}
            <p className={settings.readout}>
              <Link to="/jobs/digest">Configure on the Digest job &rarr;</Link>
            </p>
          </>
        )}
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Preview">
        <p className={settings.hint}>
          Goes to channels ticked for <strong>Digest</strong> in <SettingsPageLink to="/settings/notifications" />, and
          to portal subscribers.
        </p>

        {emailStatusQuery.data && !emailStatusQuery.data.smtpConfigured && (
          <p className={styles.notice}>
            Per-user digests need email —{" "}
            <SettingsPageLink to="/settings/notifications/smtp">Settings › Notifications › Email</SettingsPageLink>
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
              <p className={styles.empty}>Nothing happened in this period, so nothing would be sent.</p>
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
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Subscribers">
        {subscribers.length === 0 ? (
          <span className={styles.hint}>Nobody yet — portal users subscribe themselves.</span>
        ) : (
          <table className={styles.table}>
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
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Recent deliveries">
        {deliveries.length === 0 ? (
          <span className={styles.hint}>Nothing has been sent yet.</span>
        ) : (
          <table className={styles.table}>
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
      </CardSection>
    </div>
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
