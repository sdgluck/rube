import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "#/trpc";
import { EventsSkeleton } from "#components/Skeleton";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import EmptyState from "#components/EmptyState";
import PullToRefresh from "#components/PullToRefresh";
import RelativeTime from "#components/RelativeTime";
import { formatDurationMs, stripDurationFromMessage } from "#/utils";
import sharedStyles from "./Collections.module.css";
import styles from "./Events.module.css";

const BADGE_MAP: Record<string, { label: string; className: string }> = {
  "job.completed": { label: "Job Completed", className: styles.badgeJobCompleted },
  "job.failed": { label: "Job Failed", className: styles.badgeJobFailed },
  "health.failed": { label: "Health Failed", className: styles.badgeHealthFailed },
  "health.recovered": { label: "Health Recovered", className: styles.badgeHealthRecovered },
};

const PAGE_SIZE = 50;

type SortKey = "timestamp" | "type" | "message";
type SortDir = "asc" | "desc";

export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams();

  const typeFilter = searchParams.get("type") ?? "";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem("events-sort-key");
    return stored === "type" || stored === "message" || stored === "timestamp" ? stored : "timestamp";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const stored = localStorage.getItem("events-sort-dir");
    return stored === "asc" ? "asc" : "desc";
  });

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          if (key !== "page") next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      const next = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      localStorage.setItem("events-sort-dir", next);
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" ? "desc" : "asc");
      localStorage.setItem("events-sort-key", key);
      localStorage.setItem("events-sort-dir", key === "timestamp" ? "desc" : "asc");
    }
    setParam("page", "");
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");

  const debouncedSearch = useDebouncedValue(search);

  const offset = (page - 1) * PAGE_SIZE;

  const query = trpc.events.list.useQuery(
    {
      limit: PAGE_SIZE,
      offset,
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

  if (query.isLoading && !query.data) return <EventsSkeleton />;

  return (
    <PullToRefresh
      onRefresh={() => {
        query.refetch();
      }}
    >
      <div>
        <h2 className={sharedStyles.heading}>Events{total > 0 && <span className="count-badge">{total}</span>}</h2>

        <div className={sharedStyles.filters}>
          <input
            type="text"
            className={sharedStyles.searchInput}
            placeholder="Search events..."
            value={search}
            onChange={(e) => setParam("q", e.target.value)}
          />
          <select className={sharedStyles.select} value={typeFilter} onChange={(e) => setParam("type", e.target.value)}>
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
          <EmptyState icon="bell" title="No events found" />
        ) : (
          <>
            <div className="table-scroll">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={sharedStyles.sortable} onClick={() => toggleSort("timestamp")}>
                      Time{sortIndicator("timestamp")}
                    </th>
                    <th className={sharedStyles.sortable} onClick={() => toggleSort("type")}>
                      Type{sortIndicator("type")}
                    </th>
                    <th className={sharedStyles.sortable} onClick={() => toggleSort("message")}>
                      Message{sortIndicator("message")}
                    </th>
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
                            <span className={styles.avgDuration}> (avg {formatDurationMs(event.avgDurationMs)})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div className={sharedStyles.pagination}>
                <button
                  className={sharedStyles.buttonSecondary}
                  disabled={page <= 1}
                  onClick={() => setParam("page", String(page - 1))}
                >
                  Previous
                </button>
                <span className={sharedStyles.paginationInfo}>
                  Page {page} of {totalPages} ({total} events)
                </span>
                <button
                  className={sharedStyles.buttonSecondary}
                  disabled={page >= totalPages}
                  onClick={() => setParam("page", String(page + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
