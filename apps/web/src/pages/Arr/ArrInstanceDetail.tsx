import { Link, useParams } from "react-router-dom";
import { formatBytes } from "@rube/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import EmptyState from "#components/EmptyState";
import RelativeTime from "#components/RelativeTime";
import { SkeletonTable } from "#components/Skeleton";
import { PageCrumbs } from "#layout/AppBar";
import QualityProfiles from "./Quality/QualityProfiles";
import styles from "./ArrInstances.module.css";

/**
 * One Radarr or Sonarr, and the settings Rube manages on it.
 *
 * `ArrInstances` linked every card here from phase 1 onward and the route did
 * not exist, so the click fell through to the catch-all. Quality profiles are
 * the first thing it holds. The rest of phase 3's settings areas belong here
 * too.
 */
export default function ArrInstanceDetail() {
  const { instanceId = "" } = useParams();
  const instancesQuery = trpc.arr.instances.useQuery();
  const stateQuery = trpc.arr.library.instanceState.useQuery({});

  if (instancesQuery.isPending) {
    return (
      <PageShell>
        <SkeletonTable rows={4} columns={4} />
      </PageShell>
    );
  }

  const instance = instancesQuery.data?.find((i) => i.id === instanceId);
  if (!instance) {
    return (
      <PageShell>
        <EmptyState icon="cog" title="No such instance" action={<Link to="/arrs">All instances</Link>} />
      </PageShell>
    );
  }

  const state = stateQuery.data?.find((s) => s.instanceId === instance.id);

  return (
    <PageShell
      chip={
        state?.lastError ? (
          <StatusChip tone="error" dot>
            Unreachable
          </StatusChip>
        ) : (
          <StatusChip tone="ok" dot>
            OK
          </StatusChip>
        )
      }
    >
      <PageCrumbs crumbs={[{ label: instance.name }]} />

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
          <dt>Free space</dt>
          <dd>{formatBytes(state?.diskFree)}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>{state?.lastFullSyncAt ? <RelativeTime timestamp={state.lastFullSyncAt} /> : "Never"}</dd>
        </div>
      </dl>

      <QualityProfiles instanceId={instance.id} />
    </PageShell>
  );
}
