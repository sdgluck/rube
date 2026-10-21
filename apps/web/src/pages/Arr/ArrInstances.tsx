import { Link } from "react-router-dom";
import { formatBytes } from "@rube/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import RelativeTime from "#components/RelativeTime";
import RunJobButton from "#components/RunJobButton";
import shared from "#/styles/shared.module.css";
import styles from "./ArrInstances.module.css";

/**
 * Every configured Radarr and Sonarr, and whether it is well.
 *
 * All of it comes from `arr_sync_state`, which the sync and the poller keep
 * current — deliberately not a fan-out to each instance on render. One box
 * being down should show as one unhealthy card, not as a page that hangs.
 */
export default function ArrInstances() {
  const instancesQuery = trpc.arr.instances.useQuery();
  const stateQuery = trpc.arr.library.instanceState.useQuery({});

  const instances = instancesQuery.data ?? [];
  const stateById = new Map((stateQuery.data ?? []).map((s) => [s.instanceId, s]));

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
    <PageShell
      count={String(instances.length)}
      actions={
        <RunJobButton jobId="sync-arr" small>
          Sync now
        </RunJobButton>
      }
    >
      <div className={styles.instanceCards}>
        {instances.map((instance) => {
          const state = stateById.get(instance.id);
          const failed = Boolean(state?.lastError);
          return (
            <section key={instance.id} className={styles.instanceCard}>
              <header className={styles.instanceCardHead}>
                <Link className={styles.instanceCardTitle} to={`/arrs/${instance.id}`}>
                  {instance.name}
                </Link>
                {failed ? (
                  <StatusChip tone="error" dot>
                    Unreachable
                  </StatusChip>
                ) : (
                  <StatusChip tone="ok" dot>
                    OK
                  </StatusChip>
                )}
              </header>

              <dl className={styles.stats}>
                <div>
                  <dt>Service</dt>
                  <dd>
                    {instance.service === "radarr" ? "Radarr" : "Sonarr"}
                    {state?.arrVersion ? ` ${state.arrVersion}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>{instance.service === "radarr" ? "Movies" : "Series"}</dt>
                  <dd>{state?.itemCount?.toLocaleString() ?? "—"}</dd>
                </div>
                <div>
                  <dt>Queue</dt>
                  <dd>{state?.queueCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Free space</dt>
                  <dd>{formatBytes(state?.diskFree)}</dd>
                </div>
                <div>
                  <dt title="Counts and free space are from this sync; queues are live">Last synced</dt>
                  <dd>{state?.lastFullSyncAt ? <RelativeTime timestamp={state.lastFullSyncAt} /> : "Never"}</dd>
                </div>
              </dl>

              {/* The error is shown in full rather than summarised: on a
                  self-hosted box the text is usually the whole diagnosis
                  ("connect ECONNREFUSED 127.0.0.1:7878"). */}
              {failed && <p className={styles.error}>{state?.lastError}</p>}
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
