import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { keepPreviousData } from "@tanstack/react-query";
import pMap from "p-map";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import BulkLabelsModal from "#components/BulkLabelsModal";
import { CollectionsSkeleton } from "#components/Skeleton";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import Pagination from "#components/Pagination";
import SortableTh from "#components/SortableTh";
import { useListParams } from "#hooks/useListParams";
import FadeImage from "#components/FadeImage";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import PullToRefresh from "#components/PullToRefresh";
import PageShell from "#components/PageShell";
import { readEnumStorage, writeStorage } from "#/storage";
import styles from "#/styles/shared.module.css";

const SORT_KEYS = ["title", "sectionTitle", "childCount", "smart", "labels", "addedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const PAGE_SIZE = 50;

export default function Collections() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sectionFilter = searchParams.get("section") ?? "";
  // Backward-compat: older links used `?label=Rule:<id>` for the rule filter.
  const rawLabel = searchParams.get("label") ?? "";
  const labelFilter = rawLabel.startsWith("Rule:") ? "" : rawLabel;
  const ruleIdFilter = searchParams.get("ruleId") ?? (rawLabel.startsWith("Rule:") ? rawLabel.slice(5) : "");
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const { sortKey, sortDir, toggleSort, setPage } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
    descFirst: ["addedAt", "childCount"],
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => readEnumStorage("collections-view", VIEW_MODES, "table"));

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
          // Reset page when filters/sort change
          if (key !== "page") {
            next.delete("page");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSectionFilter = useCallback((v: string) => setParam("section", v), [setParam]);
  const setLabelFilter = useCallback(
    (v: string) => {
      // When picking a label, drop any rule-shaped param so filters don't double-up.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("ruleId");
          if (v) next.set("label", v);
          else next.delete("label");
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setRuleFilter = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          // Strip any legacy `label=Rule:*` form too.
          if (next.get("label")?.startsWith("Rule:")) next.delete("label");
          if (id) next.set("ruleId", id);
          else next.delete("ruleId");
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setSearch = useCallback((v: string) => setParam("q", v), [setParam]);

  const debouncedSearch = useDebouncedValue(search);
  const { addToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label?: string } | null>(null);
  const [labelEditing, setLabelEditing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const navigate = useNavigate();

  const offset = (page - 1) * PAGE_SIZE;

  const collectionsQuery = trpc.collections.list.useQuery(
    {
      sectionId: sectionFilter || undefined,
      label: labelFilter || undefined,
      ruleId: ruleIdFilter || undefined,
      search: debouncedSearch || undefined,
      offset,
      limit: PAGE_SIZE,
      sort: sortKey,
      sortDir,
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  // Lightweight query for populating filter dropdowns
  const filtersQuery = trpc.collections.filters.useQuery(undefined, { refetchOnWindowFocus: false });
  const rulesQuery = trpc.rules.list.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 60_000 });

  const deleteMutation = trpc.collections.delete.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation();

  const collections = collectionsQuery.data?.items ?? [];
  const total = collectionsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const parseLabels = (labels: string[] | null | undefined): string[] => labels ?? [];

  // Derive sections and labels from lightweight filters query
  const sections = filtersQuery.data?.sections ?? [];
  const allLabels = useMemo(
    () => (filtersQuery.data?.labels ?? []).filter((l) => !l.startsWith("Rule:")),
    [filtersQuery.data?.labels],
  );
  const rules = rulesQuery.data ?? [];
  const activeRule = ruleIdFilter ? rules.find((r) => r.id === ruleIdFilter) : null;
  const ruleNameById = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);

  const findRuleId = (labels: string[]): string | null => {
    for (const l of labels) {
      if (l.startsWith("Rule:")) return l.slice(5);
    }
    return null;
  };

  // Unique labels across selected collections
  const selectedLabels = [
    ...new Set(collections.filter((c) => selected.has(c.plexRatingKey)).flatMap((c) => parseLabels(c.labels))),
  ].sort();

  // Clear selection when filters change
  useEffect(() => {
    setSelected(new Set());
    setLabelEditing(false);
  }, [sectionFilter, labelFilter, ruleIdFilter, debouncedSearch]);

  const handleDelete = (ratingKey: string, title: string) => {
    setPendingConfirm({
      message: `Delete "${title}"? This will remove it from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await deleteMutation.mutateAsync({ ratingKey });
          addToast(`Deleted "${title}"`, "success");
          collectionsQuery.refetch();
          filtersQuery.refetch();
        } catch {
          addToast(`Failed to delete "${title}"`, "error");
        }
      },
    });
  };

  const handleBulkDelete = () => {
    const count = selected.size;
    setPendingConfirm({
      message: `Delete ${count} collection(s)? This will remove them from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        setBulkProgress({ done: 0, total: count });
        let deleted = 0;
        let failed = 0;
        await pMap(
          [...selected],
          async (ratingKey) => {
            try {
              await deleteMutation.mutateAsync({ ratingKey });
              deleted++;
            } catch {
              failed++;
            }
            setBulkProgress({ done: deleted + failed, total: count });
          },
          { concurrency: 5 },
        );
        setSelected(new Set());
        setBulkProgress(null);
        if (failed > 0) {
          addToast(`Deleted ${deleted}, failed ${failed}`, "error");
        } else {
          addToast(`Deleted ${deleted} collection(s)`, "success");
        }
        collectionsQuery.refetch();
        filtersQuery.refetch();
      },
    });
  };

  const handleBulkEditLabels = async (input: { add: string[]; remove: Set<string> }) => {
    const addList = input.add;
    const removeSet = input.remove;

    if (addList.length === 0 && removeSet.size === 0) return;

    setLabelEditing(false);

    const selectedCollections = collections.filter((c) => selected.has(c.plexRatingKey));
    const total = selectedCollections.length;
    setBulkProgress({ done: 0, total, label: "Updating labels" });

    let updated = 0;
    let failed = 0;
    for (const col of selectedCollections) {
      const current = parseLabels(col.labels);
      const newLabels = [...new Set([...current.filter((l) => !removeSet.has(l)), ...addList])];
      try {
        await updateLabelsMutation.mutateAsync({ ratingKey: col.plexRatingKey, labels: newLabels });
        updated++;
      } catch {
        failed++;
      }
      setBulkProgress({ done: updated + failed, total, label: "Updating labels" });
    }

    setSelected(new Set());
    setBulkProgress(null);
    if (failed > 0) {
      addToast(`Updated ${updated}, failed ${failed}`, "error");
    } else {
      addToast(`Updated labels on ${updated} collection(s)`, "success");
    }
    collectionsQuery.refetch();
    filtersQuery.refetch();
  };

  const handleCheckboxClick = (index: number, e: React.MouseEvent) => {
    const key = collections[index].plexRatingKey;

    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          next.add(collections[i].plexRatingKey);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    lastClickedIndex.current = index;
  };

  const toggleSelectAll = () => {
    if (selected.size === collections.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(collections.map((c) => c.plexRatingKey)));
    }
  };

  if (collectionsQuery.isLoading && !collectionsQuery.data) return <CollectionsSkeleton />;
  if (collectionsQuery.error && !collectionsQuery.data) {
    return (
      <ErrorState
        title="Couldn't load collections"
        error={collectionsQuery.error}
        onRetry={() => collectionsQuery.refetch()}
      />
    );
  }

  return (
    <PullToRefresh
      onRefresh={() => {
        collectionsQuery.refetch();
        filtersQuery.refetch();
      }}
    >
      <PageShell
        title="Collections"
        count={total > 0 ? total.toLocaleString() : undefined}
        subtitle="Every collection Tinkerbell can see in Plex, whether it built it or you did."
      >
        {(selected.size > 0 || bulkProgress) && (
          <div className={styles.bulkBar}>
            {bulkProgress ? (
              <>
                <span className={styles.bulkCount}>
                  {bulkProgress.label || "Deleting"} {bulkProgress.done}/{bulkProgress.total}...
                </span>
                <div className={styles.bulkProgressBar}>
                  <div
                    className={styles.bulkProgressFill}
                    style={{ width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <span className={styles.bulkCount}>{selected.size} selected</span>
                <button
                  className={`${styles.buttonSmall} ${styles.buttonSecondary}`}
                  onClick={() => setLabelEditing(true)}
                >
                  Edit Labels
                </button>
                <button className={`${styles.buttonDanger} ${styles.buttonSmall}`} onClick={handleBulkDelete}>
                  Delete {selected.size}
                </button>
                <button
                  className={`${styles.buttonSmall} ${styles.buttonSecondary}`}
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}

        <div className={styles.filters}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search collections…"
            aria-label="Search collections"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={styles.select} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select className={styles.select} value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
            <option value="">All labels</option>
            {allLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={ruleIdFilter} onChange={(e) => setRuleFilter(e.target.value)}>
            <option value="">All rules</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {ruleIdFilter && !activeRule && <option value={ruleIdFilter}>Rule {ruleIdFilter} (deleted)</option>}
          </select>
          <div className={styles.filtersSpacer} />
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => {
                setViewMode("table");
                writeStorage("collections-view", "table");
              }}
            >
              Table
            </button>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => {
                setViewMode("grid");
                writeStorage("collections-view", "grid");
              }}
            >
              Grid
            </button>
          </div>
        </div>

        {collections.length === 0 ? (
          search || sectionFilter || labelFilter || ruleIdFilter ? (
            <EmptyState icon="search" title="No collections match your filters" />
          ) : (
            <EmptyState icon="stack" title="No collections synced yet" />
          )
        ) : (
          <>
            {viewMode === "grid" ? (
              <div className={styles.grid}>
                {collections.map((col) => (
                  <div
                    key={col.plexRatingKey}
                    className={styles.card}
                    onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                  >
                    {col.thumb ? (
                      <FadeImage
                        className={styles.cardPoster}
                        src={`/api/plex-image?path=${encodeURIComponent(col.thumb)}`}
                        alt={col.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.cardPosterPlaceholder}>No poster</div>
                    )}
                    <div className={styles.cardTitle} title={col.title}>
                      {col.title}
                    </div>
                    <div className={styles.cardMeta}>
                      {col.childCount} item{col.childCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.checkboxCell}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          aria-label="Select all collections"
                          checked={collections.length > 0 && selected.size === collections.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Title
                      </SortableTh>
                      <SortableTh sortKey="sectionTitle" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Section
                      </SortableTh>
                      <SortableTh sortKey="childCount" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Items
                      </SortableTh>
                      <SortableTh sortKey="smart" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Smart
                      </SortableTh>
                      <SortableTh sortKey="labels" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Labels
                      </SortableTh>
                      <th>Rule</th>
                      <SortableTh sortKey="addedAt" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                        Added
                      </SortableTh>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {collections.map((col, i) => {
                      const labels = parseLabels(col.labels);
                      return (
                        <tr
                          key={col.plexRatingKey}
                          className={`${styles.clickableRow} ${selected.has(col.plexRatingKey) ? styles.selectedRow : ""}`}
                          onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                        >
                          <td
                            className={styles.checkboxCell}
                            data-cell="hide"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCheckboxClick(i, e);
                            }}
                          >
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={selected.has(col.plexRatingKey)}
                              readOnly
                            />
                          </td>
                          <td data-cell="title">{col.title}</td>
                          <td data-cell="meta">{col.sectionTitle}</td>
                          <td data-cell="meta">{col.childCount}</td>
                          <td data-cell="hide">{col.smart ? "Yes" : "No"}</td>
                          <td data-cell="hide">
                            {labels
                              .filter((l) => !l.startsWith("Rule:"))
                              .map((label) => (
                                <span
                                  key={label}
                                  className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(label.toLowerCase()) ? styles.labelTinkerbell : label.toLowerCase().startsWith("user:") ? styles.labelUser : ""}`}
                                >
                                  {label}
                                </span>
                              ))}
                          </td>
                          <td data-cell="hide" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const rid = findRuleId(labels);
                              if (!rid) return <span className={styles.muted}>—</span>;
                              const name = ruleNameById.get(rid);
                              return (
                                <Link to={`/rules?focus=${rid}`} className={styles.ruleLink} title="Open rule">
                                  {name ?? `Rule ${rid.slice(0, 8)}`}
                                </Link>
                              );
                            })()}
                          </td>
                          <td data-cell="meta">
                            {col.addedAt ? <RelativeTime timestamp={col.addedAt} seconds /> : ""}
                          </td>
                          <td data-cell="hide">
                            <button
                              className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(col.plexRatingKey, col.title);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination page={page} totalPages={totalPages} total={total} noun="collections" onPageChange={setPage} />
          </>
        )}

        {pendingConfirm && (
          <ConfirmModal
            title="Delete collection?"
            message={pendingConfirm.message}
            confirmLabel="Delete"
            danger
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        )}

        {labelEditing && (
          <BulkLabelsModal
            count={selected.size}
            existingLabels={selectedLabels}
            onApply={handleBulkEditLabels}
            onCancel={() => setLabelEditing(false)}
          />
        )}
      </PageShell>
    </PullToRefresh>
  );
}
