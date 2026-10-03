import { formatBytes, formatCustomFormatScore, type ArrService } from "@tinkerbell/contracts";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Spinner from "#components/Spinner";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import { StatusChip } from "#components/PageShell";
import { useToast } from "#components/Toast";
import {
  sortReleases,
  releaseAge,
  rejectionSummary,
  protocolLabel,
  qualityLabel,
  type ReleaseRow,
} from "#lib/releases";
import shared from "#/styles/shared.module.css";
import controls from "#/styles/controls.module.css";
import styles from "./ReleaseTable.module.css";

/**
 * Interactive release search — picking a specific release yourself.
 *
 * **This is a mutation, and that is not an implementation detail.** Asking for
 * releases hits every configured indexer and takes minutes. As a query,
 * TanStack would fire it on mount and again on every window focus, which is
 * how somebody gets rate-limited by their indexer for reading a page. The
 * client sets `retries: 0` on the same call for the same reason: by the time
 * it fails, the indexers have already been asked.
 *
 * So nothing happens until the button is pressed, and the results live in the
 * mutation's own `data` rather than in a cache that could be revalidated
 * behind the user's back.
 */
export default function ReleaseTable({
  service,
  instanceId,
  arrId,
  seasonNumber,
}: {
  service: ArrService;
  instanceId: string;
  arrId: number;
  /** Sonarr only. Absent means the whole series. */
  seasonNumber?: number;
}) {
  const { addToast } = useToast();
  const search = trpc.arr.activity.releases.useMutation();
  const utils = trpc.useUtils();
  const grab = trpc.arr.activity.grabRelease.useMutation({
    onSuccess: () => {
      addToast("Sent to the download client", "success");
      void utils.arr.activity.queue.invalidate();
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const rows = sortReleases((search.data ?? []) as ReleaseRow[]);

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <button
          type="button"
          className={controls.btnSecondary}
          onClick={() => search.mutate({ service, instanceId, arrId, seasonNumber })}
          disabled={search.isPending}
        >
          {search.isPending && <Spinner size="sm" />}
          {search.isPending ? "Searching indexers…" : "Search indexers"}
        </button>
        {search.isPending && <p className={styles.hint}>May take a few minutes.</p>}
      </header>

      {search.isError && (
        <ErrorState title="The search failed" error={search.error} onRetry={() => search.reset()} inline />
      )}

      {search.isSuccess &&
        (rows.length === 0 ? (
          <EmptyState
            icon="search"
            title="No releases"
            action={
              <>
                <button
                  type="button"
                  className={controls.btnSecondary}
                  onClick={() => search.mutate({ service, instanceId, arrId, seasonNumber })}
                >
                  Retry
                </button>{" "}
                <Link to={`/arrs/${instanceId}`}>Check the instance</Link>
              </>
            }
          />
        ) : (
          <table className={shared.compactTable}>
            <thead>
              <tr>
                <th>Release</th>
                <th>Indexer</th>
                <th>Age</th>
                <th>Size</th>
                <th>Peers</th>
                <th>Quality</th>
                <th>Score</th>
                <th aria-label="Grab" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rejection = row.rejected ? rejectionSummary(row.rejections) : null;
                return (
                  <tr key={row.guid} className={row.rejected ? styles.rejected : undefined}>
                    <td>
                      <span className={styles.title} title={row.title}>
                        {row.title}
                      </span>
                      {rejection && (
                        <div className={styles.rejection}>
                          <StatusChip tone="error">{rejection}</StatusChip>
                        </div>
                      )}
                    </td>
                    <td className={shared.cellMuted}>
                      {row.indexer ?? "—"}
                      <span className={styles.protocol}>{protocolLabel(row.protocol)}</span>
                    </td>
                    <td className={shared.cellNum}>{releaseAge(row.ageHours)}</td>
                    <td className={shared.cellNum}>{formatBytes(row.size)}</td>
                    <td className={shared.cellNum}>
                      {row.seeders === undefined ? "—" : `${row.seeders}/${row.leechers ?? 0}`}
                    </td>
                    <td className={shared.cellMuted}>{qualityLabel(row)}</td>
                    <td className={shared.cellNum}>{formatCustomFormatScore(row.customFormatScore)}</td>
                    <td>
                      {/* A rejected release stays grabbable. Overriding the
                          *Arr's refusal is the reason to run an interactive
                          search at all — it will usually still take it. */}
                      <button
                        type="button"
                        className={controls.btnSm}
                        onClick={() => grab.mutate({ service, instanceId, release: row })}
                        disabled={grab.isPending}
                        title={
                          rejection
                            ? `${service === "radarr" ? "Radarr" : "Sonarr"} rejected this: ${rejection}`
                            : undefined
                        }
                      >
                        Grab
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </section>
  );
}
