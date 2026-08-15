import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { keepPreviousData } from "@tanstack/react-query";
import pMap from "p-map";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import BulkBar from "#components/BulkBar";
import BulkLabelsModal from "#components/BulkLabelsModal";
import { CollectionsSkeleton } from "#components/Skeleton";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import MultiSelect from "#components/MultiSelect";
import Pagination from "#components/Pagination";
import SortableTh from "#components/SortableTh";
import { useListParams } from "#hooks/useListParams";
import FadeImage from "#components/FadeImage";
import RelativeTime from "#components/RelativeTime";
import RowActions from "#components/RowActions";
import { useToast } from "#components/Toast";
import PullToRefresh from "#components/PullToRefresh";
import PageShell from "#components/PageShell";
import { readEnumStorage, writeStorage } from "#/storage";
import { errorMessage } from "#/utils";
import SearchInput from "#components/SearchInput";
import styles from "#/styles/shared.module.css";

const SORT_KEYS = ["title", "sectionTitle", "childCount", "smart", "labels", "addedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const PAGE_SIZE = 50;

export default function Collections() {
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const { sortKey, sortDir, listParam, toggleSort, setPage } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
    descFirst: ["addedAt", "childCount"],
  });

  const sectionFilter = listParam("section");
  const rawLabels = listParam("label");
  const labelFilter = rawLabels.filter((l) => !l.startsWith("Rule:"));
  // Backward-compat: older links carried the rule filter as `?label=Rule:<id>`.
  const ruleIdFilter = [
    ...new Set([...listParam("ruleId"), ...rawLabels.filter((l) => l.startsWith("Rule:")).map((l) => l.slice(5))]),
  ];
  /** Stable identity for the filter set, for effects that reset when it changes. */
  const filterKey = JSON.stringify([sectionFilter, labelFilter, ruleIdFilter]);
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

  /**
   * Writes all three value filters at once, always in canonical form: plain
   * labels in `label`, rule ids in `ruleId`.
   *
   * Every write goes through here so the legacy `label=Rule:<id>` spelling is
   * normalised away the first time any filter is touched. Writing one param in
   * isolation would leave a legacy link's rule filter behind in `label`, where
   * unticking that rule in the menu couldn't reach it.
   */
  const setFilters = useCallback(
    (next: { sections?: string[]; labels?: string[]; ruleIds?: string[] }) => {
      const sections = next.sections ?? sectionFilter;
      const labels = next.labels ?? labelFilter;
      const ruleIds = next.ruleIds ?? ruleIdFilter;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const key of ["section", "label", "ruleId", "page"]) params.delete(key);
          for (const value of sections) params.append("section", value);
          for (const value of labels) params.append("label", value);
          for (const value of ruleIds) params.append("ruleId", value);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, sectionFilter, labelFilter, ruleIdFilter],
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
      sectionIds: sectionFilter,
      labels: labelFilter,
      ruleIds: ruleIdFilter,
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
  const ruleNameById = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);
  /**
   * Rule options: every rule, plus any filtered-on id that no longer resolves
   * to one. A link to a since-deleted rule still filters, so the menu has to be
   * able to show it ticked and let the user untick it.
   */
  const ruleOptions = useMemo(() => {
    const options = rules.map((r) => ({ value: r.id, label: r.name }));
    for (const id of ruleIdFilter) {
      if (!ruleNameById.has(id)) options.push({ value: id, label: `Rule ${id} (deleted)` });
    }
    return options;
  }, [rules, ruleNameById, filterKey]);

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
  }, [filterKey, debouncedSearch]);

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
        } catch (err) {
          // Plex has plenty of reasons to refuse a delete (media deletion
          // disabled, non-owner token, collection already gone) and it used to
          // report all of them as a bare "Failed to delete", which reads as the
          // button being broken rather than the server saying no.
          addToast(`Failed to delete "${title}": ${errorMessage(err)}`, "error");
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
        // Bulk deletes fail for one reason far more often than several, so
        // reporting the first one turns "failed 12" into something actionable
        // without stacking a dozen identical toasts.
        let firstError = "";
        await pMap(
          [...selected],
          async (ratingKey) => {
            try {
              await deleteMutation.mutateAsync({ ratingKey });
              deleted++;
            } catch (err) {
              failed++;
              if (!firstError) firstError = errorMessage(err);
            }
            setBulkProgress({ done: deleted + failed, total: count });
          },
          { concurrency: 5 },
        );
        setSelected(new Set());
        setBulkProgress(null);
        if (failed > 0) {
          addToast(`Deleted ${deleted}, failed ${failed}: ${firstError}`, "error");
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
      <PageShell count={total > 0 ? total.toLocaleString() : undefined}>
        {(selected.size > 0 || bulkProgress) && (
          <BulkBar
            count={selected.size}
            noun="collection"
            progress={bulkProgress ? { ...bulkProgress, label: bulkProgress.label || "Deleting" } : null}
            onClear={() => setSelected(new Set())}
            actions={[
              { label: "Edit labels", onClick: () => setLabelEditing(true) },
              { label: `Delete ${selected.size}`, tone: "danger", onClick: handleBulkDelete },
            ]}
          />
        )}

        <div className={styles.filters}>
          <SearchInput
            placeholder="Search collections…"
            ariaLabel="Search collections"
            value={search}
            onChange={setSearch}
          />
          <MultiSelect
            allLabel="All sections"
            ariaLabel="Filter by library section"
            options={sections.map((s) => ({ value: s.id, label: s.title }))}
            selected={sectionFilter}
            onChange={(sections) => setFilters({ sections })}
          />
          <MultiSelect
            allLabel="All labels"
            ariaLabel="Filter by label"
            options={allLabels.map((label) => ({ value: label, label }))}
            selected={labelFilter}
            onChange={(labels) => setFilters({ labels })}
          />
          <MultiSelect
            allLabel="All rules"
            ariaLabel="Filter by rule"
            options={ruleOptions}
            selected={ruleIdFilter}
            onChange={(ruleIds) => setFilters({ ruleIds })}
          />
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
          search || sectionFilter.length > 0 || labelFilter.length > 0 || ruleIdFilter.length > 0 ? (
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
                              // A deleted rule has no name to search Rules by,
                              // so there's nothing to link to.
                              if (!name) return <span className={styles.muted}>Rule {rid.slice(0, 8)}</span>;
                              return (
                                <Link
                                  to={`/rules?q=${encodeURIComponent(name)}`}
                                  className={styles.ruleLink}
                                  title="Open rule"
                                >
                                  {name}
                                </Link>
                              );
                            })()}
                          </td>
                          <td data-cell="meta">
                            {col.addedAt ? <RelativeTime timestamp={col.addedAt} seconds /> : ""}
                          </td>
                          <td data-cell="hide">
                            <RowActions
                              label={`Actions for ${col.title}`}
                              actions={[
                                {
                                  label: "Open",
                                  icon: ExternalLink,
                                  onSelect: () => navigate(`/collections/${col.plexRatingKey}`),
                                },
                                {
                                  label: "Delete",
                                  icon: Trash2,
                                  danger: true,
                                  onSelect: () => handleDelete(col.plexRatingKey, col.title),
                                },
                              ]}
                            />
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
