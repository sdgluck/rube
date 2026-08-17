import { Check, Filter, Minus } from "lucide-react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { FormSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { NOTIFICATION_SERVICES } from "./notifications.config";
import settings from "#pages/Settings/Settings.module.css";
import styles from "./SettingsNotificationsRouting.module.css";

/**
 * The routing table, as the dispatcher would decide it right now.
 *
 * Routing is three orthogonal axes per service — subscribed events, a job
 * allow-list, a health-target allow-list — across nine services, plus quiet
 * hours over the top. Each axis is a checkbox on a different tab, so the
 * question anyone actually has ("if Radarr goes down at 3am, what happens?")
 * could only be answered by holding four screens in your head at once.
 *
 * Every cell is also the test send for that pairing. The target was otherwise
 * a 10px dot, and what you want to test is exactly the thing the cell is
 * describing.
 */

const CELL_TITLE = {
  on: "Subscribed — press to send a sample",
  filtered: "Subscribed, but narrowed by an allow-list — press to send a sample",
  off: "Not subscribed",
} as const;

function serviceTitle(service: string): string {
  return NOTIFICATION_SERVICES[service]?.title ?? service;
}

export default function SettingsNotificationsRouting() {
  const routing = trpc.notifications.routing.useQuery(undefined, { refetchOnWindowFocus: false });
  const testEvent = trpc.notifications.testEvent.useMutation();
  const { addToast } = useToast();

  const send = (service: string, type: string, label: string) => {
    testEvent.mutate(
      { service: service as never, type },
      {
        onSuccess: () => addToast(`Sent a sample “${label}” to ${serviceTitle(service)}.`, "success"),
        onError: (err) => addToast(err.message, "error"),
      },
    );
  };

  if (routing.isLoading) return <FormSkeleton rows={6} />;
  if (routing.error || !routing.data) {
    return <ErrorState title="Couldn't load routing" error={routing.error} onRetry={() => routing.refetch()} />;
  }

  const { rows, services } = routing.data;

  return (
    <div className={settings.form}>
      <p className={settings.hint}>
        What would happen, right now, if each event fired. Subscriptions, the job and health-target allow-lists and
        quiet hours are all folded in — this is the decision the dispatcher makes, not a summary of the checkboxes.
        Press any cell to send that service a sample of that event.
      </p>

      <div className={styles.scroller}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th className={styles.eventHead} scope="col">
                Event
              </th>
              {services.map((service) => (
                <th key={service} className={styles.serviceHead} scope="col">
                  {serviceTitle(service)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type} className={row.suppressed ? styles.suppressedRow : ""}>
                <th className={styles.eventHead} scope="row">
                  <span className={styles.eventLabel}>
                    {row.label}
                    {!row.emitted && <span className={styles.notEmitted}> · routing target</span>}
                  </span>
                  {row.suppressed && <span className={styles.suppressedNote}>held by {row.suppressed}</span>}
                </th>
                {row.services.map((cell) => {
                  const Icon = cell.state === "on" ? Check : cell.state === "filtered" ? Filter : Minus;
                  const detail = cell.state === "filtered" ? ` Only: ${cell.filter?.join(", ")}.` : "";
                  return (
                    <td key={cell.service} className={styles.cell}>
                      <button
                        type="button"
                        className={`${styles.cellButton} ${styles[cell.state]}`}
                        disabled={cell.state === "off" || testEvent.isPending}
                        onClick={() => send(cell.service, row.type, row.label)}
                        title={`${serviceTitle(cell.service)} · ${row.label}. ${CELL_TITLE[cell.state]}.${detail}`}
                        aria-label={`${row.label} to ${serviceTitle(cell.service)}: ${CELL_TITLE[cell.state]}.${detail}`}
                      >
                        <Icon size={15} aria-hidden />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <Check size={14} className={styles.on} aria-hidden /> subscribed
        </span>
        <span className={styles.legendItem}>
          <Filter size={14} className={styles.filtered} aria-hidden /> subscribed, narrowed by an allow-list
        </span>
        <span className={styles.legendItem}>
          <Minus size={14} className={styles.off} aria-hidden /> not subscribed
        </span>
      </div>

      <p className={settings.hint}>
        A greyed row is one quiet hours would hold right now. Suppression is delivery-only and happens late, so the
        event is still recorded in Activity either way — and it now leaves a <em>Not Notified</em> entry beside it, so a
        silent phone can be told apart from a broken webhook.
      </p>
    </div>
  );
}
