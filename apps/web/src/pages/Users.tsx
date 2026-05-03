import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "../trpc";
import { UsersSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import RelativeTime from "../RelativeTime";
import { useToast } from "../Toast";
import sharedStyles from "./Collections.module.css";
import styles from "./Users.module.css";

const PAGE_SIZE = 50;

type SortKey = "username" | "name" | "collectionCount" | "lastWatchedAt";
type SortDir = "asc" | "desc";

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
      {value || <span className={styles.namePlaceholder}>Set name...</span>}
    </span>
  );
}

export default function Users() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem("users-sort-key");
    return stored === "name" || stored === "collectionCount" || stored === "lastWatchedAt" || stored === "username"
      ? stored
      : "username";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const stored = localStorage.getItem("users-sort-dir");
    return stored === "desc" ? "desc" : "asc";
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
      localStorage.setItem("users-sort-dir", next);
    } else {
      setSortKey(key);
      const defaultDir = key === "lastWatchedAt" ? "desc" : "asc";
      setSortDir(defaultDir);
      localStorage.setItem("users-sort-key", key);
      localStorage.setItem("users-sort-dir", defaultDir);
    }
    setParam("page", "");
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

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

  const users = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (query.isLoading && !query.data) return <UsersSkeleton />;
  if (query.error) return <div className={`${sharedStyles.toast} ${sharedStyles.error}`}>Failed to load users</div>;

  return (
    <div>
      <h2 className={sharedStyles.heading}>Users{total > 0 && <span className="count-badge">{total}</span>}</h2>

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
              placeholder="Search users..."
              value={search}
              onChange={(e) => setParam("q", e.target.value)}
            />
          </div>

          {users.length === 0 ? (
            <EmptyState icon="search" title="No users match your search" />
          ) : (
            <>
              <div className="table-scroll">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={sharedStyles.sortable} onClick={() => toggleSort("username")}>
                        Username{sortIndicator("username")}
                      </th>
                      <th className={sharedStyles.sortable} onClick={() => toggleSort("name")}>
                        Name{sortIndicator("name")}
                      </th>
                      <th>Label</th>
                      <th className={sharedStyles.sortable} onClick={() => toggleSort("collectionCount")}>
                        Collections{sortIndicator("collectionCount")}
                      </th>
                      <th className={sharedStyles.sortable} onClick={() => toggleSort("lastWatchedAt")}>
                        Last Watched{sortIndicator("lastWatchedAt")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.userId}>
                        <td>{user.username}</td>
                        <td>
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
                        <td>
                          <span className={`${styles.label} ${styles.labelUser}`}>{user.label}</span>
                        </td>
                        <td>{user.collectionCount}</td>
                        <td>
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
                    Page {page} of {totalPages} ({total} users)
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
        </>
      )}
    </div>
  );
}
