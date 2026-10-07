import { useState } from "react";
import { Link } from "react-router-dom";
import { formatBytes, type ArrService, type DownloadClientOverview } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import styles from "./ArrDownloads.module.css";
import DownloadClientsPanel from "./DownloadClientsPanel";
import {
  clientItemState,
  findClientItem,
  indexClientItems,
  queueState,
  type ClientMatch,
  type QueueState,
} from "./queue-state.ts";

/**
 * What is coming.
 *
 * Live-proxied on a short interval, never mirrored: a stored queue looks
 * authoritative and is wrong within seconds. Only the *count* is cached, in
 * `arr_sync_state`, so the nav badge does not have to make a network call on
 * every page load.
 */

/** Queue states that mean a human needs to look. */
const BLOCKED = new Set(["importBlocked", "importPending", "failedPending"]);

function progress(size: number | undefined, left: number | undefined): number | null {
  if (!size || size <= 0 || left === undefined) return null;
  return Math.min(1, Math.max(0, (size - left) / size));
}

function QueueStateCell({ label, tone }: QueueState) {
  return tone ? <StatusChip tone={tone}>{label}</StatusChip> : <span className={shared.cellMuted}>{label}</span>;
}

interface ItemControls {
  clientItems: Map<string, ClientMatch>;
  /** `clientId:itemId` of an item action in flight. */
  pendingItem: string | null;
  onToggleItem: (match: ClientMatch, pause: boolean) => void;
}

function QueueForInstance({
  service,
  instanceId,
  name,
  clientItems,
  pendingItem,
  onToggleItem,
}: { service: ArrService; instanceId: string; name: string } & ItemControls) {
  const query = trpc.arr.activity.queue.useQuery(
    { service, instanceId, pageSize: 100 },
    // Five seconds: this is the one screen where somebody is watching a number
    // move. It only polls while the tab is visible.
    { refetchInterval: 5_000 },
  );

  if (query.isError) {
    return <ErrorState title={`Couldn't reach ${name}`} error={query.error} onRetry={() => query.refetch()} inline />;
  }

  const records = query.data?.records ?? [];
  if (records.length === 0) return null;

  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{name}</h3>
        <span className={styles.groupCount}>{records.length}</span>
      </header>

      <div className="table-scroll">
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Progress</th>
              <th>Size</th>
              <th>Left</th>
              <th>Client</th>
              <th>State</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {records.map((item) => {
              // The client's own item, where Tinkerbell can reach that client:
              // fresher than the *Arr's copy, and the thing pause acts on.
              const match = findClientItem(clientItems, item.downloadId);
              const pct = match?.item.progress ?? progress(item.size, item.sizeleft);
              const blocked = BLOCKED.has(item.trackedDownloadState ?? "") || item.trackedDownloadStatus === "error";
              return (
                <tr key={item.id}>
                  <td>{item.title ?? "—"}</td>
                  <td>
                    {pct === null ? (
                      "—"
                    ) : (
                      <span className={styles.progress}>
                        <span className={styles.progressBar}>
                          <span className={styles.progressFill} style={{ width: `${Math.round(pct * 100)}%` }} />
                        </span>
                        <span className={shared.cellNum}>{Math.round(pct * 100)}%</span>
                      </span>
                    )}
                  </td>
                  <td className={shared.cellNum}>{formatBytes(item.size)}</td>
                  <td className={shared.cellMuted}>{item.timeleft ?? "—"}</td>
                  <td className={shared.cellMuted}>{match?.clientName ?? item.downloadClient ?? "—"}</td>
                  <td>
                    {blocked ? (
                      // `errorMessage` and the status messages are where the
                      // actual diagnosis lives — "importBlocked" alone tells
                      // nobody why.
                      <StatusChip tone="error">
                        {item.errorMessage ?? item.statusMessages?.[0]?.title ?? item.trackedDownloadState ?? "Blocked"}
                      </StatusChip>
                    ) : (
                      <QueueStateCell {...(match ? clientItemState(match.item) : queueState(item))} />
                    )}
                  </td>
                  <td>
                    {match && (
                      <button
                        type="button"
                        className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                        disabled={pendingItem === `${match.clientId}:${match.item.id}`}
                        onClick={() => onToggleItem(match, !match.item.paused)}
                      >
                        {match.item.paused ? "Resume" : "Pause"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ArrDownloads() {
  const instancesQuery = trpc.arr.instances.useQuery();
  const stateQuery = trpc.arr.library.instanceState.useQuery({}, { refetchInterval: 15_000 });
  const activityQuery = trpc.arr.activity.recent.useQuery({ limit: 50 });
  const [tab, setTab] = useState<"queue" | "activity">("queue");
  const clientsQuery = trpc.downloadClients.overview.useQuery(undefined, { refetchInterval: 5_000 });
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [pendingClient, setPendingClient] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<string | null>(null);

  const clients: DownloadClientOverview[] = clientsQuery.data ?? [];
  const clientItems = indexClientItems(clients);

  // Refetched on settle rather than patched optimistically: the client decides
  // what a pause did (a torrent client may be mid-check and refuse), and the
  // next read is the honest answer.
  const settle = async () => {
    await Promise.all([utils.downloadClients.overview.invalidate(), utils.arr.activity.queue.invalidate()]);
  };
  const fail = (err: { message: string }) => addToast(err.message, "error");
  const pause = trpc.downloadClients.pause.useMutation({ onError: fail, onSettled: settle });
  const resume = trpc.downloadClients.resume.useMutation({ onError: fail, onSettled: settle });
  const pauseItem = trpc.downloadClients.pauseItem.useMutation({ onError: fail, onSettled: settle });
  const resumeItem = trpc.downloadClients.resumeItem.useMutation({ onError: fail, onSettled: settle });

  const toggleClient = async (id: string, shouldPause: boolean) => {
    setPendingClient(id);
    try {
      await (shouldPause ? pause : resume).mutateAsync({ id }).catch(() => undefined);
    } finally {
      setPendingClient(null);
    }
  };

  const toggleItem = async (match: ClientMatch, shouldPause: boolean) => {
    setPendingItem(`${match.clientId}:${match.item.id}`);
    try {
      await (shouldPause ? pauseItem : resumeItem)
        .mutateAsync({ id: match.clientId, itemId: match.item.id })
        .catch(() => undefined);
    } finally {
      setPendingItem(null);
    }
  };

  const instances = instancesQuery.data ?? [];
  const queued = (stateQuery.data ?? []).reduce((n, s) => n + (s.queueCount ?? 0), 0);

  if (instances.length === 0) {
    return (
      <PageShell>
        <EmptyState
          icon="cog"
          title="No media managers configured"
          action={
            <Link to="/settings/arrs" className={shared.button}>
              Add Radarr or Sonarr
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell count={queued > 0 ? String(queued) : undefined}>
      <div className={shared.pageTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queue"}
          className={tab === "queue" ? `${shared.pageTab} ${shared.pageTabActive}` : shared.pageTab}
          onClick={() => setTab("queue")}
        >
          Queue
          {queued > 0 && <span className={shared.pageTabCount}>{queued}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "activity"}
          className={tab === "activity" ? `${shared.pageTab} ${shared.pageTabActive}` : shared.pageTab}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>

      {tab === "queue" && clientsQuery.data && (
        <DownloadClientsPanel clients={clients} pending={pendingClient} onToggle={toggleClient} />
      )}

      {tab === "queue" ? (
        queued === 0 ? (
          <EmptyState icon="list" title="Nothing downloading" />
        ) : (
          instances.map((instance) => (
            <QueueForInstance
              key={instance.id}
              service={instance.service}
              instanceId={instance.id}
              name={instance.name}
              clientItems={clientItems}
              pendingItem={pendingItem}
              onToggleItem={toggleItem}
            />
          ))
        )
      ) : (
        <div className="table-scroll">
          <table className={shared.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Title</th>
                <th>Release</th>
                <th>Indexer</th>
              </tr>
            </thead>
            <tbody>
              {(activityQuery.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className={shared.cellMuted}>
                    <RelativeTime timestamp={row.date} />
                  </td>
                  <td>{row.eventType}</td>
                  <td>{row.title || "—"}</td>
                  <td className={shared.cellMuted}>{row.sourceTitle || "—"}</td>
                  <td className={shared.cellMuted}>{row.indexer || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
