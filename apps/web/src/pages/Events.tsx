import { keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { eventLink } from "#/eventLinks";
import { EventsSkeleton } from "#components/Skeleton";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { useListParams } from "#hooks/useListParams";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import MultiSelect from "#components/MultiSelect";
import PageShell, { StatusChip } from "#components/PageShell";
import Pagination from "#components/Pagination";
import PullToRefresh from "#components/PullToRefresh";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import { formatDuration } from "#/format";
import { stripDurationFromMessage } from "#/utils";
import SearchInput from "#components/SearchInput";
import sharedStyles from "#/styles/shared.module.css";
import styles from "./Events.module.css";

const BADGE_MAP: Record<string, { label: string; className: string }> = {
  "job.completed": { label: "Job Completed", className: styles.badgeJobCompleted },
  "job.failed": { label: "Job Failed", className: styles.badgeJobFailed },
  "health.failed": { label: "Health Failed", className: styles.badgeHealthFailed },
  "health.recovered": { label: "Health Recovered", className: styles.badgeHealthRecovered },
  "bandwidth.tested": { label: "Bandwidth Tested", className: styles.badgeBandwidthTested },
  "plex.unreachable": { label: "Plex Unreachable", className: styles.badgeHealthFailed },
  "media.added": { label: "Media Added", className: styles.badgeLibrary },
  "collection.created": { label: "Collection Created", className: styles.badgeLibrary },
  "digest.sent": { label: "Digest Sent", className: styles.badgeLibrary },
  "rule.empty": { label: "Rule Matched Nothing", className: styles.badgeAttention },
  "registry.update_available": { label: "Registry Update", className: styles.badgeAttention },
  // What quiet hours (or a mute) stopped. The event it refers to is in the
  // feed either way; this is the record that your phone stayed silent on
  // purpose rather than because a webhook URL had rotted.
  "notification.suppressed": { label: "Not Notified", className: styles.badgeDefault },
};

const PAGE_SIZE = 50;
const SORT_KEYS = ["timestamp", "type", "message"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default function Events() {
  const { sortKey, sortDir, page, param, listParam, setParam, setListParam, setParams, setPage, toggleSort } =
    useListParams<SortKey>({
      sortKeys: SORT_KEYS,
      defaultSortKey: "timestamp",
      defaultSortDir: "desc",
      descFirst: ["timestamp"],
    });

  const typeFilter = listParam("type");
  const search = param("q");
  const debouncedSearch = useDebouncedValue(search);

  const query = trpc.events.list.useQuery(
    {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      types: typeFilter,
      search: debouncedSearch || undefined,
      sort: sortKey,
      sortDir,
    },
    { refetchInterval: 10000, refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  const typesQuery = trpc.events.types.useQuery(undefined, { refetchOnWindowFocus: false });
  // The same tally the sidebar shows, so the header chip can't disagree with
  // the rail beside it.
  const metricsQuery = trpc.nav.metrics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const errors24h = metricsQuery.data?.eventsErrors24h ?? 0;

  const events = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const eventTypes = typesQuery.data ?? [];
  const isFiltered = typeFilter.length > 0 || !!search;

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
        count={total > 0 ? total.toLocaleString() : undefined}
        chip={
          errors24h > 0 ? (
            <StatusChip tone="error" dot>
              {errors24h} error{errors24h === 1 ? "" : "s"} 24h
            </StatusChip>
          ) : undefined
        }
      >
        <div className={sharedStyles.filters}>
          <SearchInput
            placeholder="Search events…"
            ariaLabel="Search events"
            value={search}
            onChange={(v) => setParam("q", v)}
          />
          <MultiSelect
            allLabel="All types"
            ariaLabel="Filter by event type"
            options={eventTypes.map((t) => ({ value: t, label: BADGE_MAP[t]?.label ?? t }))}
            selected={typeFilter}
            onChange={(next) => setListParam("type", next)}
          />
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
              <table className={sharedStyles.table}>
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
                    const to = eventLink(event);
                    const text =
                      event.count > 1 && event.avgDurationMs != null
                        ? stripDurationFromMessage(event.message)
                        : event.message;
                    return (
                      <tr key={event.id}>
                        <td data-cell="meta" className={styles.timestamp}>
                          <RelativeTime timestamp={event.timestamp} />
                        </td>
                        <td data-cell="pill">
                          <span className={`${sharedStyles.statusPill} ${badge.className}`}>{badge.label}</span>
                        </td>
                        <td data-cell="title">
                          {/* Only the message is the link — the repeat count and
                              the average duration describe the roll-up, not the
                              one occurrence you'd be opening. */}
                          {to ? (
                            <Link to={to} className={styles.messageLink}>
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                          {event.count > 1 && event.avgDurationMs != null && (
                            <span className={styles.avgDuration}> (avg {formatDuration(event.avgDurationMs)})</span>
                          )}
                          {/* Repeats collapse into a trailing count rather than
                              prefixing the type, which read as part of the name. */}
                          {event.count > 1 && (
                            <span className={sharedStyles.countBadge} title={`Repeated ${event.count} times`}>
                              {event.count}×
                            </span>
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
