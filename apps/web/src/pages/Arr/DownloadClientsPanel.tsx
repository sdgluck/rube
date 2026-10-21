import { Link } from "react-router-dom";
import { DOWNLOAD_CLIENT_META, formatBytes, type DownloadClientOverview } from "@rube/contracts";
import { StatusChip } from "#components/PageShell";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import styles from "./ArrDownloads.module.css";

/**
 * The download clients themselves, above the *Arr queues: whether each is
 * reachable, paused or moving, and the switch to pause or resume it.
 *
 * qBittorrent and Transmission have no global pause — their own "pause all"
 * pauses each torrent, seeding ones included — so the button says so on hover
 * rather than letting somebody stop their seeding by surprise.
 */

function clientState(client: DownloadClientOverview) {
  if (!client.ok) return <StatusChip tone="error">{client.error}</StatusChip>;
  if (client.status.paused) return <StatusChip tone="advisory">Paused</StatusChip>;
  const active = client.items.filter((i) => i.state === "downloading").length;
  if (active === 0) return <span className={shared.cellMuted}>Idle</span>;
  return (
    <StatusChip tone="running" dot>
      Downloading
    </StatusChip>
  );
}

export default function DownloadClientsPanel({
  clients,
  pending,
  onToggle,
}: {
  clients: DownloadClientOverview[];
  /** The client id an action is in flight for, so its button can't be double-pressed. */
  pending: string | null;
  onToggle: (id: string, pause: boolean) => void;
}) {
  if (clients.length === 0) {
    return (
      <p className={shared.cellMuted}>
        <Link to="/settings/arrs/download-clients">Add your download clients</Link> to see their state and pause or
        resume them here.
      </p>
    );
  }

  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <h3 className={styles.groupTitle}>Download clients</h3>
        <span className={styles.groupCount}>{clients.length}</span>
      </header>
      <div className="table-scroll">
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Client</th>
              <th>State</th>
              <th>Speed</th>
              <th>Active</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const meta = DOWNLOAD_CLIENT_META[client.kind];
              const paused = client.ok && client.status.paused;
              return (
                <tr key={client.id}>
                  <td>{client.name}</td>
                  <td className={shared.cellMuted}>
                    {meta.label}
                    {client.ok && client.status.version ? ` ${client.status.version}` : ""}
                  </td>
                  <td>{clientState(client)}</td>
                  <td className={shared.cellNum}>
                    {client.ok && client.status.speed !== null && !paused
                      ? `${formatBytes(client.status.speed)}/s`
                      : "—"}
                  </td>
                  <td className={shared.cellNum}>{client.ok ? client.items.length : "—"}</td>
                  <td>
                    {client.ok && (
                      <button
                        type="button"
                        className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
                        disabled={pending === client.id}
                        title={
                          meta.globalPause === "every-item"
                            ? `${meta.label} has no global pause: this ${paused ? "resumes" : "pauses"} every torrent, seeding ones included.`
                            : undefined
                        }
                        onClick={() => onToggle(client.id, !paused)}
                      >
                        {paused ? "Resume" : "Pause"}
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
