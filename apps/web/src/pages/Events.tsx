import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "#/trpc";
import { EventsSkeleton } from "#components/Skeleton";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { useListParams } from "#hooks/useListParams";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell from "#components/PageShell";
import Pagination from "#components/Pagination";
import PullToRefresh from "#components/PullToRefresh";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import { formatDuration } from "#/format";
import { stripDurationFromMessage } from "#/utils";
import sharedStyles from "#/styles/shared.module.css";
import styles from "./Events.module.css";

const BADGE_MAP: Record<string, { label: string; className: string }> = {
  "job.completed": { label: "Job Completed", className: styles.badgeJobCompleted },
  "job.failed": { label: "Job Failed", className: styles.badgeJobFailed },
  "health.failed": { label: "Health Failed", className: styles.badgeHealthFailed },
  "health.recovered": { label: "Health Recovered", className: styles.badgeHealthRecovered },
};

const PAGE_SIZE = 50;
const SORT_KEYS = ["timestamp", "type", "message"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default function Events() {
  const { sortKey, sortDir, page, param, setParam, setParams, setPage, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "timestamp",
    defaultSortDir: "desc",
    descFirst: ["timestamp"],
  });

  const typeFilter = param("type");
  const search = param("q");
  const debouncedSearch = useDebouncedValue(search);

  const query = trpc.events.list.useQuery(
    {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      type: typeFilter || undefined,
      search: debouncedSearch || undefined,
      sort: sortKey,
      sortDir,
    },
    { refetchInterval: 10000, refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  const typesQuery = trpc.events.types.useQuery(undefined, { refetchOnWindowFocus: false });

  const events = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const eventTypes = typesQuery.data ?? [];
  const isFiltered = !!(typeFilter || search);

  if (query.isLoading && !query.data) return <EventsSkeleton />;
  if (query.error && !query.data) {
    return <ErrorState title="Couldn't load events" error={query.error} onRetry={() => query.refetch()} />;
  }

  return (
    <PullToRefresh
      onRefresh={() => {
        query.refetch();
      }}
    >
      <PageShell
        title="Events"
        count={total > 0 ? total.toLocaleString() : undefined}
        subtitle="Everything Tinkerbell has done and everything that happened to it, newest first."
      >
        <div className={sharedStyles.filters}>
          <input
            type="text"
            className={sharedStyles.searchInput}
            placeholder="Search events…"
            aria-label="Search events"
            value={search}
            onChange={(e) => setParam("q", e.target.value)}
          />
          <select
            className={sharedStyles.select}
            value={typeFilter}
            aria-label="Filter by event type"
            onChange={(e) => setParam("type", e.target.value)}
          >
            <option value="">All types</option>
            {eventTypes.map((t) => {
              const badge = BADGE_MAP[t];
              return (
                <option key={t} value={t}>
                  {badge ? badge.label : t}
                </option>
              );
            })}
          </select>
        </div>

        {events.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon="search"
              title="No events match your filters"
              description="Try a different search term or event type."
              action={
                <button
                  type="button"
                  className={sharedStyles.buttonSecondary}
                  onClick={() => setParams({ q: "", type: "" })}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon="bell"
              title="No events yet"
              description="Job runs and health checks record their outcomes here."
            />
          )
        ) : (
          <>
            <div className="table-scroll">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortableTh sortKey="timestamp" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Time
                    </SortableTh>
                    <SortableTh sortKey="type" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Type
                    </SortableTh>
                    <SortableTh sortKey="message" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                      Message
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const badge = BADGE_MAP[event.type] ?? {
                      label: event.type,
                      className: styles.badgeDefault,
                    };
                    return (
                      <tr key={event.id}>
                        <td className={styles.timestamp}>
                          <RelativeTime timestamp={event.timestamp} />
                        </td>
                        <td>
                          <span className={`${styles.badge} ${badge.className}`}>
                            {event.count > 1 ? `${event.count}× ` : ""}
                            {badge.label}
                          </span>
                        </td>
                        <td>
                          {event.count > 1 && event.avgDurationMs != null
                            ? stripDurationFromMessage(event.message)
                            : event.message}
                          {event.count > 1 && event.avgDurationMs != null && (
                            <span className={styles.avgDuration}> (avg {formatDuration(event.avgDurationMs)})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalPages={totalPages} total={total} noun="events" onPageChange={setPage} />
          </>
        )}
      </PageShell>
    </PullToRefresh>
  );
}
