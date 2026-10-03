import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatBytes, seriesProgress, type ArrService } from "@tinkerbell/contracts";
import { PageCrumbs } from "#layout/AppBar";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import { DetailSkeleton } from "#components/Skeleton";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import FadeImage from "#components/FadeImage";
import Modal from "#components/Modal";
import ToggleSwitch from "#components/ToggleSwitch";
import ReleaseTable from "#components/ReleaseTable";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import RunJobButton from "#components/RunJobButton";
import shared from "#/styles/shared.module.css";
import controls from "#/styles/controls.module.css";
import styles from "./ArrItemDetail.module.css";

interface Season {
  seasonNumber: number;
  monitored: boolean;
  episodeCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
}

/** The mirror row, narrowed the way `ArrLibrary` narrows its list rows. */
interface ItemRow {
  instanceId: string;
  arrId: number;
  title: string;
  year: number | null;
  posterUrl: string;
  monitored: boolean;
  hasFile?: boolean;
  status: string;
  path: string;
  rootFolderPath: string;
  sizeOnDisk: number | null;
  runtime: number | null;
  certification: string;
  studio?: string;
  network?: string;
  genres: string[] | null;
  fileQuality?: string;
  episodeCount?: number;
  episodeFileCount?: number;
  seasons?: Season[] | null;
  plexRatingKey: string | null;
  addedAt: number | null;
}

type Tab = "overview" | "seasons" | "releases";

/**
 * One record in one *Arr.
 *
 * The page `/movies` and `/tv` have always linked to and which, until now, did
 * not exist — those links fell through the router's catch-all to `/stats`.
 *
 * Reads come from the mirror, because they are already there and a page view
 * should not cost a round trip to Radarr. Everything that *changes* something
 * goes straight upstream and writes its result back, which is the same split
 * the library router documents.
 */
export default function ArrItemDetail({ service }: { service: ArrService }) {
  const { instanceId = "", arrId: arrIdParam = "" } = useParams();
  const arrId = Number(arrIdParam);
  const isMovie = service === "radarr";
  const { addToast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>(undefined);
  const [removing, setRemoving] = useState(false);

  const utils = trpc.useUtils();
  const query = trpc.arr.library.get.useQuery(
    { service, instanceId, arrId },
    { enabled: !!instanceId && Number.isFinite(arrId) },
  );

  const instancesQuery = trpc.arr.instances.useQuery();
  const instanceName = (instancesQuery.data ?? []).find((i) => i.id === instanceId)?.name ?? instanceId;

  const invalidate = () => {
    void utils.arr.library.get.invalidate({ service, instanceId, arrId });
    void utils.arr.library.list.invalidate();
  };

  const setMonitored = trpc.arr.library.setMonitored.useMutation({
    onSuccess: invalidate,
    onError: (err) => addToast(err.message, "error"),
  });
  const setSeasonMonitored = trpc.arr.library.setSeasonMonitored.useMutation({
    onSuccess: invalidate,
    onError: (err) => addToast(err.message, "error"),
  });
  const search = trpc.arr.library.search.useMutation({
    onSuccess: () => addToast("Search started", "success"),
    onError: (err) => addToast(err.message, "error"),
  });
  const refresh = trpc.arr.library.refresh.useMutation({
    onSuccess: () => addToast("Refresh started", "success"),
    onError: (err) => addToast(err.message, "error"),
  });
  const remove = trpc.arr.library.remove.useMutation({
    onSuccess: () => {
      addToast(`Removed from ${instanceName}`, "success");
      setRemoving(false);
      invalidate();
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const episodesQuery = trpc.arr.library.episodes.useQuery(
    { instanceId, seriesId: arrId, seasonNumber: selectedSeason },
    { enabled: !isMovie && tab === "seasons" && selectedSeason !== undefined },
  );

  if (query.isLoading)
    return (
      <PageShell>
        <DetailSkeleton />
      </PageShell>
    );

  if (query.isError) {
    return (
      <PageShell>
        <ErrorState title="Couldn't load this record" error={query.error} onRetry={() => query.refetch()} />
      </PageShell>
    );
  }

  const row = query.data as ItemRow | undefined;
  if (!row) {
    return (
      <PageShell>
        <EmptyState
          icon="film"
          title="Not synced yet"
          action={
            <>
              <RunJobButton jobId="sync-arr" variant="primary">
                Sync now
              </RunJobButton>{" "}
              <Link to={isMovie ? "/movies" : "/tv"}>Back to the library</Link>
            </>
          }
        />
      </PageShell>
    );
  }

  const seasons = (row.seasons ?? []).filter((s) => s.seasonNumber > 0);
  const present = isMovie ? row.hasFile === true : (row.episodeFileCount ?? 0) > 0;
  const progress = isMovie ? null : seriesProgress(row.episodeFileCount ?? 0, row.episodeCount ?? 0);

  return (
    <PageShell
      actions={
        <>
          <button
            type="button"
            className={controls.btnGhost}
            onClick={() => refresh.mutate({ service, instanceId, arrId })}
            disabled={refresh.isPending}
          >
            Refresh
          </button>
          <button type="button" className={controls.btnDangerOutline} onClick={() => setRemoving(true)}>
            Remove
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={() => search.mutate({ service, instanceId, arrId })}
            disabled={search.isPending}
          >
            Search
          </button>
        </>
      }
    >
      {/* `routeTrail` already puts Movies / TV in front of a record page. */}
      <PageCrumbs crumbs={[{ label: row.title }]} />

      <div className={shared.detailLayout}>
        <div className={shared.detailPoster}>
          {row.posterUrl ? (
            <FadeImage src={row.posterUrl} alt="" className={shared.detailPosterImg} />
          ) : (
            <div className={shared.detailPosterPlaceholder}>No poster</div>
          )}
        </div>

        <div className={shared.detailMain}>
          <div className={shared.detailHeader}>
            <h2 className={shared.heading}>{row.title}</h2>
            <label className={styles.monitorToggle}>
              <span>Monitored</span>
              <ToggleSwitch
                checked={row.monitored}
                onChange={(monitored) => setMonitored.mutate({ service, instanceId, arrId, monitored })}
                size="sm"
                disabled={setMonitored.isPending}
              />
            </label>
          </div>

          <div className={shared.detailMetaRow}>
            <span className={shared.metaChip}>{row.year ?? "—"}</span>
            <span className={shared.metaChip}>{instanceName}</span>
            {row.status && <span className={shared.metaChip}>{row.status}</span>}
            {row.certification && <span className={shared.metaChip}>{row.certification}</span>}
            {!row.monitored && <StatusChip tone="advisory">Unmonitored</StatusChip>}
            {row.monitored && !present && <StatusChip tone="advisory">Missing</StatusChip>}
            {/* The cross-application fact neither Plex nor the *Arr can state
                on its own, and the reason the mirror stores a Plex link. */}
            {present && !row.plexRatingKey && <StatusChip tone="error">Not in Plex</StatusChip>}
            {present && row.plexRatingKey && (
              <Link className={shared.metaChipLink} to={`/media/${row.plexRatingKey}`}>
                In Plex
              </Link>
            )}
          </div>

          <div className={shared.pageTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "overview"}
              className={tab === "overview" ? `${shared.pageTab} ${shared.pageTabActive}` : shared.pageTab}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            {!isMovie && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "seasons"}
                className={tab === "seasons" ? `${shared.pageTab} ${shared.pageTabActive}` : shared.pageTab}
                onClick={() => setTab("seasons")}
              >
                Seasons
                <span className={shared.pageTabCount}>{seasons.length}</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === "releases"}
              className={tab === "releases" ? `${shared.pageTab} ${shared.pageTabActive}` : shared.pageTab}
              onClick={() => setTab("releases")}
            >
              Releases
            </button>
          </div>

          {tab === "overview" && (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>Size on disk</dt>
                <dd>{formatBytes(row.sizeOnDisk)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{isMovie ? "Quality" : "Episodes"}</dt>
                <dd>
                  {isMovie
                    ? row.fileQuality || "—"
                    : progress === null
                      ? "—"
                      : `${row.episodeFileCount} of ${row.episodeCount}`}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>Root folder</dt>
                <dd>{row.rootFolderPath || "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Path</dt>
                <dd className={styles.path}>{row.path || "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{isMovie ? "Studio" : "Network"}</dt>
                <dd>{(isMovie ? row.studio : row.network) || "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Genres</dt>
                <dd>{row.genres?.length ? row.genres.join(", ") : "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Added</dt>
                <dd>{row.addedAt ? <RelativeTime timestamp={row.addedAt} /> : "—"}</dd>
              </div>
            </dl>
          )}

          {tab === "seasons" && !isMovie && (
            <section className={shared.detailSection}>
              <table className={shared.compactTable}>
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Episodes</th>
                    <th>Size</th>
                    <th>Monitored</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((season) => (
                    <tr key={season.seasonNumber}>
                      <td>
                        <button
                          type="button"
                          className={styles.seasonBtn}
                          onClick={() =>
                            setSelectedSeason((current) =>
                              current === season.seasonNumber ? undefined : season.seasonNumber,
                            )
                          }
                          aria-expanded={selectedSeason === season.seasonNumber}
                        >
                          Season {season.seasonNumber}
                        </button>
                      </td>
                      <td className={shared.cellNum}>
                        {season.episodeFileCount}/{season.episodeCount}
                      </td>
                      <td className={shared.cellNum}>{formatBytes(season.sizeOnDisk)}</td>
                      <td>
                        <ToggleSwitch
                          checked={season.monitored}
                          onChange={(monitored) =>
                            setSeasonMonitored.mutate({
                              instanceId,
                              arrId,
                              seasonNumber: season.seasonNumber,
                              monitored,
                            })
                          }
                          size="xs"
                          disabled={setSeasonMonitored.isPending}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={controls.btnSm}
                          onClick={() =>
                            search.mutate({ service, instanceId, arrId, seasonNumber: season.seasonNumber })
                          }
                          disabled={search.isPending}
                        >
                          Search
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Episodes are proxied, never mirrored — five hundred shows is
                  fifty thousand rows, and this is the one season somebody
                  actually opened. */}
              {selectedSeason !== undefined && (
                <div className={styles.episodes}>
                  <h3 className={shared.detailSectionTitle}>Season {selectedSeason}</h3>
                  {episodesQuery.isError ? (
                    <ErrorState
                      title="Couldn't load episodes"
                      error={episodesQuery.error}
                      onRetry={() => episodesQuery.refetch()}
                      inline
                    />
                  ) : (
                    <table className={shared.compactTable}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Title</th>
                          <th>Aired</th>
                          <th>File</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(episodesQuery.data ?? []).map((episode) => (
                          <tr key={episode.id}>
                            <td className={shared.cellNum}>{episode.episodeNumber}</td>
                            <td>{episode.title ?? "—"}</td>
                            <td className={shared.cellMuted}>{episode.airDate ?? "—"}</td>
                            <td>
                              {episode.hasFile ? (
                                <StatusChip tone="ok">On disk</StatusChip>
                              ) : (
                                <span className={shared.cellMuted}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "releases" && (
            <ReleaseTable
              service={service}
              instanceId={instanceId}
              arrId={arrId}
              seasonNumber={isMovie ? undefined : selectedSeason}
            />
          )}
        </div>
      </div>

      {removing && (
        <RemoveModal
          title={row.title}
          instanceName={instanceName}
          pending={remove.isPending}
          onCancel={() => setRemoving(false)}
          onConfirm={(opts) =>
            remove.mutate({
              service,
              targets: [{ instanceId, arrIds: [arrId] }],
              deleteFiles: opts.deleteFiles,
              addImportExclusion: opts.addImportExclusion,
            })
          }
        />
      )}
    </PageShell>
  );
}

/**
 * Removal, with both consequences stated.
 *
 * Not `ConfirmModal`: the router deliberately gives `deleteFiles` and
 * `addImportExclusion` no defaults, because one deletes files from disk and
 * the other writes a permanent "never bring this back" entry. A yes/no prompt
 * would have to choose for the user, which is exactly what the API refuses to
 * do.
 */
function RemoveModal({
  title,
  instanceName,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  instanceName: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (opts: { deleteFiles: boolean; addImportExclusion: boolean }) => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [addImportExclusion, setAddImportExclusion] = useState(false);

  return (
    <Modal
      open
      onClose={onCancel}
      title={`Remove ${title}?`}
      size="sm"
      dismissOnBackdrop={false}
      footer={
        <div className={styles.removeFooter}>
          <button type="button" className={controls.btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={controls.btnDanger}
            onClick={() => onConfirm({ deleteFiles, addImportExclusion })}
            disabled={pending}
          >
            Remove
          </button>
        </div>
      }
    >
      <p className={styles.removeMessage}>
        This removes the record from {instanceName}. Choose what else should happen.
      </p>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
        <span>
          Delete files from disk
          <span className={styles.checkHint}>Permanent. Plex will show the item as missing until it rescans.</span>
        </span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={addImportExclusion} onChange={(e) => setAddImportExclusion(e.target.checked)} />
        <span>
          Add an import exclusion
          <span className={styles.checkHint}>Stops an import list putting it back on the next sync.</span>
        </span>
      </label>
    </Modal>
  );
}
