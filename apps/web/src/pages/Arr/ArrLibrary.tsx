import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { formatBytes, seriesProgress, type ArrService } from "@rube/contracts";
import { trpc } from "#/trpc";
import PageShell, { StatusChip } from "#components/PageShell";
import Pagination from "#components/Pagination";
import SortableTh from "#components/SortableTh";
import SearchInput from "#components/SearchInput";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import InstancePicker from "#components/InstancePicker";
import FadeImage from "#components/FadeImage";
import RunJobButton from "#components/RunJobButton";
import { useListParams } from "#hooks/useListParams";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import shared from "#/styles/shared.module.css";
import styles from "./ArrLibrary.module.css";

const SORT_KEYS = ["title", "year", "added", "size"] as const;

/** Tri-state filters, read from the URL. "" means no filter at all. */
function triState(value: string): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

/**
 * The unified library — every Radarr, or every Sonarr, in one sortable list.
 *
 * Served entirely from the local mirror. That is not an optimisation: the
 * *Arrs have no paged library endpoint at all, so the only way to render a
 * sorted, filtered page across four instances is to have the rows locally.
 */
export default function ArrLibrary({ service }: { service: ArrService }) {
  const [searchParams] = useSearchParams();
  const { sortKey, sortDir, page, param, setParams, toggleSort, setPage } = useListParams({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
    descFirst: ["added", "size", "year"],
  });

  const instanceId = searchParams.get("instance") || undefined;
  const search = param("q");
  const debouncedSearch = useDebouncedValue(search, 250);

  const query = trpc.arr.library.list.useQuery(
    {
      service,
      instanceId,
      search: debouncedSearch || undefined,
      monitored: triState(param("monitored")),
      hasFile: triState(param("hasFile")),
      inPlex: triState(param("inPlex")),
      sort: sortKey,
      direction: sortDir,
      page,
      pageSize: 50,
    },
    { placeholderData: keepPreviousData },
  );

  const instancesQuery = trpc.arr.instances.useQuery();
  const instanceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instancesQuery.data ?? []) map.set(i.id, i.name);
    return map;
  }, [instancesQuery.data]);

  /** Several instances of one service is what makes the column worth showing. */
  const showInstance = (instancesQuery.data ?? []).filter((i) => i.service === service).length > 1;

  if (query.isError) {
    return (
      <PageShell>
        <ErrorState title="Couldn't load the library" error={query.error} onRetry={() => query.refetch()} />
      </PageShell>
    );
  }

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const isMovies = service === "radarr";

  return (
    <PageShell count={total > 0 ? String(total) : undefined}>
      <div className={shared.filters}>
        <SearchInput
          value={search}
          onChange={(value) => setParams({ q: value })}
          placeholder={isMovies ? "Search movies…" : "Search series…"}
        />
        <InstancePicker service={service} value={instanceId} onChange={(id) => setParams({ instance: id ?? "" })} />
        <div className={shared.filtersSpacer} />
        <select
          className={shared.select}
          value={param("monitored")}
          onChange={(e) => setParams({ monitored: e.target.value })}
          aria-label="Monitored"
        >
          <option value="">Any monitoring</option>
          <option value="yes">Monitored</option>
          <option value="no">Unmonitored</option>
        </select>
        <select
          className={shared.select}
          value={param("hasFile")}
          onChange={(e) => setParams({ hasFile: e.target.value })}
          aria-label="On disk"
        >
          <option value="">Any file state</option>
          <option value="yes">On disk</option>
          <option value="no">Missing</option>
        </select>
        {/* The cross-app filter, and the reason the mirror stores a Plex link
            at all. "Downloaded, not in Plex" is invisible from inside either
            application. */}
        <select
          className={shared.select}
          value={param("inPlex")}
          onChange={(e) => setParams({ inPlex: e.target.value })}
          aria-label="In Plex"
        >
          <option value="">Plex: any</option>
          <option value="yes">In Plex</option>
          <option value="no">Not in Plex</option>
        </select>
      </div>

      {rows.length === 0 && !query.isFetching ? (
        total === 0 && !search ? (
          <EmptyState
            icon="film"
            title={isMovies ? "No movies synced yet" : "No series synced yet"}
            action={
              <RunJobButton jobId="sync-arr" variant="primary">
                Sync now
              </RunJobButton>
            }
          />
        ) : (
          <EmptyState icon="film" title="No records match these filters" />
        )
      ) : (
        <>
          <div className="table-scroll">
            <table className={shared.table}>
              <thead>
                <tr>
                  <th className={styles.posterCol} aria-label="Poster" />
                  <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Title
                  </SortableTh>
                  <SortableTh sortKey="year" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Year
                  </SortableTh>
                  {showInstance && <th>Instance</th>}
                  <th>{isMovies ? "Quality" : "Episodes"}</th>
                  <SortableTh sortKey="size" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Size
                  </SortableTh>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const r = row as Record<string, never> & {
                    instanceId: string;
                    arrId: number;
                    title: string;
                    year: number | null;
                    posterUrl: string;
                    monitored: boolean;
                    hasFile?: boolean;
                    episodeCount?: number;
                    episodeFileCount?: number;
                    sizeOnDisk: number | null;
                    fileQuality?: string;
                    plexRatingKey: string | null;
                  };
                  const present = isMovies ? r.hasFile === true : (r.episodeFileCount ?? 0) > 0;
                  const progress = isMovies ? null : seriesProgress(r.episodeFileCount ?? 0, r.episodeCount ?? 0);
                  return (
                    <tr key={`${r.instanceId}:${r.arrId}`}>
                      <td className={styles.posterCol}>
                        {r.posterUrl ? (
                          <FadeImage src={r.posterUrl} alt="" className={styles.poster} />
                        ) : (
                          <div className={styles.posterPlaceholder} aria-hidden="true" />
                        )}
                      </td>
                      <td>
                        <Link
                          className={shared.cellLink}
                          to={`/arrs/${r.instanceId}/${isMovies ? "movies" : "series"}/${r.arrId}`}
                        >
                          {r.title}
                        </Link>
                      </td>
                      <td className={shared.cellNum}>{r.year ?? "—"}</td>
                      {showInstance && (
                        <td className={shared.cellMuted}>{instanceNames.get(r.instanceId) ?? r.instanceId}</td>
                      )}
                      <td className={shared.cellMuted}>
                        {isMovies
                          ? r.fileQuality || "—"
                          : progress === null
                            ? "—"
                            : `${r.episodeFileCount}/${r.episodeCount}`}
                      </td>
                      <td className={shared.cellNum}>{formatBytes(r.sizeOnDisk)}</td>
                      <td>
                        {!r.monitored && <StatusChip tone="advisory">Unmonitored</StatusChip>}
                        {r.monitored && !present && <StatusChip tone="advisory">Missing</StatusChip>}
                        {/* The whole point of the cross-app link: on disk per the
                         *Arr, but Plex has never seen it. */}
                        {present && !r.plexRatingKey && <StatusChip tone="error">Not in Plex</StatusChip>}
                        {present && r.plexRatingKey && (
                          <Link className={shared.cellLink} to={`/media/${r.plexRatingKey}`}>
                            In Plex
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={Math.ceil(total / 50)}
            total={total}
            noun={isMovies ? "movies" : "series"}
            onPageChange={setPage}
          />
        </>
      )}
    </PageShell>
  );
}
