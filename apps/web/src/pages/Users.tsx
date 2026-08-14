import { useState, useEffect, useRef } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "#/trpc";
import { UsersSkeleton } from "#components/Skeleton";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell from "#components/PageShell";
import Pagination from "#components/Pagination";
import SortableTh from "#components/SortableTh";
import { useListParams } from "#hooks/useListParams";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import { formatRuntime } from "#/format";
import sharedStyles from "#/styles/shared.module.css";
import styles from "./Users.module.css";

const SORT_KEYS = ["username", "name", "collectionCount", "lastWatchedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const PAGE_SIZE = 50;

function EditableName({
  userId,
  value,
  onMutate,
  onError,
  onSettled,
}: {
  userId: number;
  value: string | null;
  onMutate: (newName: string | null) => void;
  onError: () => void;
  onSettled: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = trpc.users.update.useMutation();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    const newValue = trimmed || null;
    if (trimmed === (value ?? "")) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onMutate(newValue);
    mutation.mutate({ userId, name: newValue || undefined }, { onError, onSettled });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={styles.nameInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        disabled={mutation.isPending}
      />
    );
  }

  return (
    <span
      className={styles.nameCell}
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value || <span className={styles.namePlaceholder}>Set name…</span>}
    </span>
  );
}

export default function Users() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const { sortKey, sortDir, page, param, setParam, setPage, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "username",
    descFirst: ["lastWatchedAt", "collectionCount"],
  });

  const search = param("q");
  const debouncedSearch = useDebouncedValue(search);
  const offset = (page - 1) * PAGE_SIZE;

  const queryInput = {
    search: debouncedSearch || undefined,
    offset,
    limit: PAGE_SIZE,
    sort: sortKey as string | undefined,
    sortDir,
  };

  const query = trpc.users.list.useQuery(queryInput, {
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  // One grouped query for the whole table rather than one per row. All-time,
  // matching the lifetime framing of the neighbouring Collections count.
  const playbackQuery = trpc.stats.allUserPlayback.useQuery(undefined, { refetchOnWindowFocus: false });
  const playbackByUser = new Map((playbackQuery.data ?? []).map((r) => [r.userId, r]));

  const syncMutation = trpc.users.sync.useMutation({
    onSuccess: () => {
      utils.users.list.invalidate();
      addToast("Users refreshed", "success");
    },
    onError: () => addToast("Failed to refresh users", "error"),
  });

  const users = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (query.isLoading && !query.data) return <UsersSkeleton />;
  if (query.error && !query.data) {
    return <ErrorState title="Couldn't load users" error={query.error} onRetry={() => query.refetch()} />;
  }

  return (
    <PageShell count={total > 0 ? total.toLocaleString() : undefined}>
      {users.length === 0 && !search ? (
        <EmptyState
          icon="person"
          title="No shared users found"
          description="Users will appear here once Plex sharing is configured."
        />
      ) : (
        <>
          <div className={sharedStyles.filters}>
            <input
              type="text"
              className={sharedStyles.searchInput}
              placeholder="Search users…"
              aria-label="Search users"
              value={search}
              onChange={(e) => setParam("q", e.target.value)}
            />
            <button
              className={sharedStyles.buttonSecondary}
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {users.length === 0 ? (
            <EmptyState
              icon="search"
              title="No users match your search"
              action={
                <button type="button" className={sharedStyles.buttonSecondary} onClick={() => setParam("q", "")}>
                  Clear search
                </button>
              }
            />
          ) : (
            <>
              <div className="table-scroll">
                <table className={sharedStyles.table}>
                  <thead>
                    <tr>
                      <SortableTh sortKey="username" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Username
                      </SortableTh>
                      <SortableTh sortKey="name" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Name
                      </SortableTh>
                      <th>Personalization</th>
                      <SortableTh sortKey="collectionCount" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Collections
                      </SortableTh>
                      <th>Plays</th>
                      <SortableTh sortKey="lastWatchedAt" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Last Watched
                      </SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.userId}>
                        <td data-cell="title">{user.username}</td>
                        <td data-cell="meta">
                          <EditableName
                            userId={user.userId}
                            value={user.name}
                            onMutate={(newName) => {
                              utils.users.list.cancel(queryInput);
                              utils.users.list.setData(queryInput, (prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      items: prev.items.map((u) =>
                                        u.userId === user.userId ? { ...u, name: newName } : u,
                                      ),
                                    }
                                  : prev!,
                              );
                            }}
                            onError={() => addToast("Failed to update name", "error")}
                            onSettled={() => utils.users.list.invalidate()}
                          />
                        </td>
                        <td data-cell="pill">
                          <span
                            className={`${sharedStyles.statusPill} ${user.optedIn ? styles.pillOptedIn : styles.pillOptedOut}`}
                            title={
                              user.optedIn
                                ? "Personalized home screens are on for this user"
                                : "This user has opted out of personalization"
                            }
                          >
                            <span className={sharedStyles.statusPillDot} aria-hidden="true" />
                            {user.optedIn ? "opted in" : "opted out"}
                          </span>
                        </td>
                        <td data-cell="meta" className={`${sharedStyles.cellNum} ${styles.collectionsCell}`}>
                          {user.collectionCount}
                        </td>
                        <td data-cell="meta" className={sharedStyles.cellNum}>
                          {(() => {
                            const totals = playbackByUser.get(user.userId);
                            if (!totals || totals.plays === 0) return <span className={styles.hint}>—</span>;
                            return (
                              <span>
                                {totals.plays}
                                {totals.watchedMs > 0 && (
                                  <span className={styles.hint}> &middot; {formatRuntime(totals.watchedMs)}</span>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td data-cell="meta">
                          {user.lastWatchedTitle ? (
                            <span>
                              {user.lastWatchedTitle}
                              {user.lastWatchedAt && (
                                <span className={styles.hint}>
                                  {" "}
                                  &middot; <RelativeTime timestamp={user.lastWatchedAt} seconds />
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className={styles.hint}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination page={page} totalPages={totalPages} total={total} noun="users" onPageChange={setPage} />
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
