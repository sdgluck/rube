import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell, { StatusChip } from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import RunJobButton from "#components/RunJobButton";
import { MediaSkeleton } from "#components/Skeleton";
import { EMPTY, formatFileSize } from "#/format";
import shared from "#/styles/shared.module.css";
import styles from "./Duplicates.module.css";

/**
 * The two shapes of duplicate a Plex library accumulates.
 *
 * The first is Plex's own: one item with several files behind it. It was
 * invisible everywhere else in the app, because the resolution and codec
 * columns describe the *first* version only — a 4K remux and a 720p rip of
 * one film render as a single tidy 4K row on the Media page.
 *
 * The second is two separate items that are the same film, usually because
 * the files sit in different folders and matched separately.
 *
 * The page finds and compares; it does not delete. Removing one version of a
 * multi-version item is a Plex operation on a specific part, and a
 * one-click version of it here — against an index that is only as fresh as
 * the last sync — is not a thing to build before the finder has been lived
 * with. Every row links to the item and to Plex, where the files are listed.
 */
export default function Duplicates() {
  const query = trpc.media.duplicates.useQuery(undefined, { refetchOnWindowFocus: false });
  const identityQuery = trpc.plexIdentity.useQuery(undefined, { staleTime: Infinity, retry: false });
  const machineIdentifier = identityQuery.data?.machineIdentifier;
  // Sizes come from the media index, so they are only as fresh as the last
  // completed Sync Media — a failed or running one changed nothing.
  const syncRuns = trpc.jobs.runs.useQuery({ jobId: "sync-media", limit: 10 }, { refetchOnWindowFocus: false });
  const lastSync = syncRuns.data?.find((r) => r.status === "completed")?.finishedAt ?? null;

  if (query.isLoading) return <MediaSkeleton />;
  if (query.error) {
    return <ErrorState title="Couldn't look for duplicates" error={query.error} onRetry={() => query.refetch()} />;
  }

  const { groups, reclaimable } = query.data ?? { groups: [], reclaimable: 0 };

  const plexHref = (ratingKey: string) =>
    machineIdentifier
      ? `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${encodeURIComponent(
          `/library/metadata/${ratingKey}`,
        )}`
      : undefined;

  return (
    <PageShell
      count={groups.length > 0 ? String(groups.length) : undefined}
      actions={
        <>
          {reclaimable > 0 && <StatusChip tone="advisory">{formatFileSize(reclaimable)} recoverable</StatusChip>}
          {lastSync != null && (
            <StatusChip tone="ok">
              Sizes as of <RelativeTime timestamp={lastSync} />
            </StatusChip>
          )}
          <RunJobButton jobId="sync-media" small>
            Sync now
          </RunJobButton>
        </>
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon="film"
          title="No duplicates found"
          description="No multi-version items, and no repeated title and year."
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section key={`${group.kind}-${group.items[0].ratingKey}`} className={styles.group}>
              <header className={styles.groupHead}>
                <h3 className={styles.groupTitle}>
                  {group.title}
                  {group.year != null && <span className={styles.groupYear}>{group.year}</span>}
                  {group.kind === "versions" ? (
                    <span className={styles.kindBadge} title="One Plex item with several files">
                      Versions
                    </span>
                  ) : (
                    <span className={styles.kindBadge} title="Separate Plex items for the same title and year">
                      Same film
                    </span>
                  )}
                </h3>
                <span className={styles.groupMeta}>
                  {group.sectionTitle} ·{" "}
                  {group.kind === "versions"
                    ? `${group.items[0].versionCount} versions`
                    : `${group.items.length} entries`}
                  {group.bytes > 0 && ` · ${formatFileSize(group.bytes)}`}
                  {group.reclaimable > 0 && ` · ${formatFileSize(group.reclaimable)} recoverable`}
                </span>
              </header>

              <div className="table-scroll">
                <table className={shared.table}>
                  <thead>
                    <tr>
                      <th>Copy</th>
                      <th>Resolution</th>
                      <th>Codec</th>
                      <th>Size</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => {
                      const isKeeper = item.ratingKey === group.keeperRatingKey;
                      return (
                        <tr key={item.ratingKey} className={isKeeper ? styles.keeperRow : undefined}>
                          <td>
                            <Link to={`/media/${item.ratingKey}`}>{item.title}</Link>
                            {isKeeper && <span className={styles.keeperBadge}>Keep</span>}
                          </td>
                          <td className={shared.cellMuted}>{item.videoResolution?.toUpperCase() || EMPTY}</td>
                          <td className={shared.cellMuted}>{item.videoCodec?.toUpperCase() || EMPTY}</td>
                          <td className={shared.cellMuted}>
                            {item.fileSize != null ? formatFileSize(item.fileSize) : EMPTY}
                          </td>
                          <td>
                            {plexHref(item.ratingKey) && (
                              <a
                                className={styles.plexLink}
                                href={plexHref(item.ratingKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open in Plex
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {group.keeperReason && <p className={styles.reason}>{group.keeperReason}</p>}
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
