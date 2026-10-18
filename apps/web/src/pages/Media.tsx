import React, { useState, useEffect, useCallback } from "react";
import { EMPTY, formatFileSize } from "#/format";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "#/trpc";
import { MediaSkeleton } from "#components/Skeleton";
import Spinner from "#components/Spinner";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import MultiSelect from "#components/MultiSelect";
import PageShell from "#components/PageShell";
import Pagination from "#components/Pagination";
import RelativeTime from "#components/RelativeTime";
import SortableTh from "#components/SortableTh";
import { useListParams } from "#hooks/useListParams";
import FadeImage from "#components/FadeImage";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { readEnumStorage, writeStorage } from "#/storage";
import SearchInput from "#components/SearchInput";
import SavedViews from "#components/SavedViews";
import BulkBar from "#components/BulkBar";
import BulkLabelsModal from "#components/BulkLabelsModal";
import { useToast } from "#components/Toast";
import { describeDropped, ruleSeedFromView } from "#/lib/viewToRule";
import {
  ColumnsButton,
  reconcileColumns,
  visibleColumns as resolveVisibleColumns,
  type ColumnConfig,
  type TableColumn,
} from "#components/TableColumns";
import styles from "#/styles/shared.module.css";
import mediaStyles from "./Media.module.css";
import { plexImageUrl } from "#lib/media";

const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

/* Filter options. No "" sentinel entry — every filter is a MultiSelect, where
   "nothing ticked" is what means "no filter", and the all-label is the
   control's own empty-state text. */

const TYPE_OPTIONS = [
  { value: "movie", label: "Movies" },
  { value: "show", label: "Shows" },
  { value: "artist", label: "Music" },
  { value: "photo", label: "Photos" },
];

const RESOLUTION_OPTIONS = [
  { value: "4k", label: "4K" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "sd", label: "SD" },
];

const VIDEO_CODEC_OPTIONS = [
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "vp9", label: "VP9" },
  { value: "av1", label: "AV1" },
  { value: "mpeg4", label: "MPEG-4" },
  { value: "vc1", label: "VC-1" },
];

const AUDIO_CODEC_OPTIONS = [
  { value: "aac", label: "AAC" },
  { value: "ac3", label: "AC3 / Dolby Digital" },
  { value: "eac3", label: "EAC3 / Dolby Digital+" },
  { value: "dca", label: "DTS" },
  { value: "truehd", label: "TrueHD" },
  { value: "flac", label: "FLAC" },
];

const AUDIO_CHANNELS_OPTIONS = [
  { value: "8", label: "7.1" },
  { value: "6", label: "5.1" },
  { value: "2", label: "Stereo" },
  { value: "1", label: "Mono" },
];

const CONTAINER_OPTIONS = [
  { value: "mkv", label: "MKV" },
  { value: "mp4", label: "MP4" },
  { value: "avi", label: "AVI" },
];

const ADVANCED_FILTER_KEYS = ["res", "vcodec", "acodec", "ach", "container"] as const;

const PAGE_SIZE = 50;

const SORT_KEYS = [
  "title",
  "section",
  "type",
  "year",
  "added",
  "resolution",
  "videoCodec",
  "audioCodec",
  "audioChannels",
  "container",
  "size",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

type MediaItem = {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  type: string;
  addedAt?: number;
  sectionTitle: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  fileSize?: number;
};

const AUDIO_CHANNELS_LABELS: Record<number, string> = {
  1: "Mono",
  2: "Stereo",
  6: "5.1",
  8: "7.1",
};

const ALL_COLUMNS: TableColumn<MediaItem, SortKey>[] = [
  { id: "title", label: "Title", render: (item) => item.title },
  { id: "section", label: "Section", render: (item) => item.sectionTitle },
  { id: "type", label: "Type", render: (item) => item.type },
  { id: "year", label: "Year", render: (item) => (item.year ? String(item.year) : EMPTY), mono: true },
  {
    id: "added",
    label: "Added",
    // Plex's addedAt is in seconds — see the schema note on the column.
    render: (item) => (item.addedAt ? <RelativeTime timestamp={item.addedAt} seconds /> : EMPTY),
    mono: true,
  },
  {
    id: "resolution",
    label: "Resolution",
    render: (item) => item.videoResolution?.toUpperCase() || EMPTY,
    mono: true,
  },
  {
    id: "videoCodec",
    label: "Video Codec",
    render: (item) => item.videoCodec?.toUpperCase() || EMPTY,
    mono: true,
  },
  {
    id: "audioCodec",
    label: "Audio Codec",
    render: (item) => item.audioCodec?.toUpperCase() || EMPTY,
    mono: true,
  },
  {
    id: "audioChannels",
    label: "Channels",
    render: (item) =>
      item.audioChannels ? AUDIO_CHANNELS_LABELS[item.audioChannels] || String(item.audioChannels) : EMPTY,
    mono: true,
  },
  {
    id: "container",
    label: "Container",
    render: (item) => item.container?.toUpperCase() || EMPTY,
    mono: true,
  },
  {
    id: "size",
    label: "Size",
    // A show carries the sum over its episodes — the files belong to them, and
    // the sync rolls the total up. A dash still means "not known here", which a
    // 0 B would have read as "empty".
    render: (item) => (item.fileSize != null ? formatFileSize(item.fileSize) : EMPTY),
    mono: true,
  },
];

// `size` is included because the Storage tile links here sorted by it, and a
// list sorted by a column it doesn't show is a page that looks unsorted.
const DEFAULT_VISIBLE = ["title", "section", "type", "year", "added", "size"];

function childToMediaItem(child: {
  ratingKey: string;
  type: string;
  title: string;
  index?: number;
  year?: number;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
}): MediaItem {
  return {
    ratingKey: child.ratingKey,
    title: child.index != null ? `${child.index}. ${child.title}` : child.title,
    type: child.type,
    year: child.year,
    sectionTitle: "",
    videoResolution: child.videoResolution,
    videoCodec: child.videoCodec,
    audioCodec: child.audioCodec,
    audioChannels: child.audioChannels,
    container: child.container,
  };
}

function ChildrenRows({
  parentRatingKey,
  depth,
  colSpan,
  visibleColumns,
  expandedRows,
  toggleExpanded,
  navigate,
}: {
  parentRatingKey: string;
  depth: number;
  colSpan: number;
  visibleColumns: TableColumn<MediaItem, SortKey>[];
  expandedRows: Set<string>;
  toggleExpanded: (key: string) => void;
  navigate: (path: string) => void;
}) {
  const { data, isLoading } = trpc.media.children.useQuery({ ratingKey: parentRatingKey });

  if (isLoading) {
    return (
      <tr className={mediaStyles.childRow}>
        <td
          colSpan={colSpan}
          className={`${depth === 1 ? mediaStyles.childRowDepth1 : mediaStyles.childRowDepth2} ${mediaStyles.childRowLoading}`}
        >
          <Spinner size="xs" />
        </td>
      </tr>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <>
      {data.map((child) => {
        const isExpanded = expandedRows.has(child.ratingKey);
        const canExpand = depth === 1 && child.type === "season";
        const isEpisode = depth === 2;

        return (
          <React.Fragment key={child.ratingKey}>
            <tr className={mediaStyles.childRow} onClick={() => navigate(`/media/${child.ratingKey}`)}>
              {/* Bulk actions act on the rows the filters chose, so a season
                  or episode revealed by expanding one of them is not
                  selectable — the cell is here to keep the columns lined up. */}
              {isEpisode && <td className={styles.checkboxCell} />}
              {isEpisode ? (
                visibleColumns.map((col, colIdx) => (
                  <td
                    key={col.id}
                    className={colIdx === 0 ? mediaStyles.childRowDepth2 : col.mono ? styles.cellMuted : undefined}
                  >
                    {col.render(childToMediaItem(child))}
                  </td>
                ))
              ) : (
                <td colSpan={colSpan} className={mediaStyles.childRowDepth1}>
                  <span className={mediaStyles.childRowTitle}>
                    {canExpand && (
                      <button
                        className={mediaStyles.expandToggle}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(child.ratingKey);
                        }}
                      >
                        {isExpanded ? "\u25BC" : "\u25B6"}
                      </button>
                    )}
                    {child.title}
                    {child.leafCount != null && (
                      <span className={mediaStyles.childEpisodeCount}>
                        ({child.leafCount} episode{child.leafCount !== 1 ? "s" : ""})
                      </span>
                    )}
                  </span>
                </td>
              )}
            </tr>
            {canExpand && isExpanded && (
              <ChildrenRows
                parentRatingKey={child.ratingKey}
                depth={2}
                colSpan={colSpan}
                visibleColumns={visibleColumns}
                expandedRows={expandedRows}
                toggleExpanded={toggleExpanded}
                navigate={navigate}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function Media() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const { sortKey, sortDir, page, listParam, setParam, setListParam, setPage, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
    // "Newest first" is the only reason anyone sorts by when something arrived.
    descFirst: ["year", "added", "size"],
  });

  const sectionFilter = listParam("section");
  const typeFilter = listParam("type");
  const labelFilter = listParam("label");
  const search = searchParams.get("q") ?? "";
  const [viewMode, setViewMode] = useState<ViewMode>(() => readEnumStorage("media-view", VIEW_MODES, "table"));
  const [showAdvanced, setShowAdvanced] = useState(() => ADVANCED_FILTER_KEYS.some((k) => searchParams.has(k)));

  const resFilter = listParam("res");
  const vcodecFilter = listParam("vcodec");
  const acodecFilter = listParam("acodec");
  const achFilter = listParam("ach");
  const containerFilter = listParam("container");

  // Counts filters, not values: three codecs ticked is still one filter doing
  // the hiding, and the badge answers "how many controls are narrowing this?".
  const activeFilterCount = [resFilter, vcodecFilter, acodecFilter, achFilter, containerFilter].filter(
    (f) => f.length > 0,
  ).length;

  // Column configuration. The control, the reconcile and the reorder all live
  // in #components/TableColumns, shared with the Collections table.
  const columnsQuery = trpc.media.columns.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveColumnsMutation = trpc.media.saveColumns.useMutation({
    onSuccess: () => columnsQuery.refetch(),
  });

  const columnConfig: ColumnConfig[] = reconcileColumns(ALL_COLUMNS, DEFAULT_VISIBLE, columnsQuery.data);
  const visibleColumns = resolveVisibleColumns(ALL_COLUMNS, columnConfig);

  const clearAdvancedFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ADVANCED_FILTER_KEYS) next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /* Selection. Keyed by ratingKey and kept across pagination — a selection
     that silently emptied itself when you turned the page would be worse than
     no selection at all, because the bar would still be showing a count. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const debouncedSearch = useDebouncedValue(search);

  // Reset page when debounced search changes
  useEffect(() => {
    if (page > 1 && debouncedSearch !== (searchParams.get("q") ?? "")) {
      setParam("page", "");
    }
  }, [debouncedSearch]);

  const offset = (page - 1) * PAGE_SIZE;

  const mediaQuery = trpc.media.list.useQuery(
    {
      sectionIds: sectionFilter,
      types: typeFilter,
      search: debouncedSearch || undefined,
      offset,
      limit: PAGE_SIZE,
      videoResolutions: resFilter,
      videoCodecs: vcodecFilter,
      audioCodecs: acodecFilter,
      audioChannels: achFilter.map(Number),
      containers: containerFilter,
      labels: labelFilter,
      sort: sortKey,
      sortDir,
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false });
  const labelsQuery = trpc.media.labels.useQuery(undefined, { refetchOnWindowFocus: false });
  const labelOptions = (labelsQuery.data ?? []).map((l) => ({ value: l, label: l }));

  const utils = trpc.useUtils();
  const bulkTagsMutation = trpc.metadata.bulkTags.useMutation();
  const bulkRefreshMutation = trpc.metadata.bulkRefresh.useMutation();

  const items = mediaQuery.data?.items ?? [];
  const total = mediaQuery.data?.total ?? 0;

  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(i.ratingKey));
  const someOnPageSelected = items.some((i) => selected.has(i.ratingKey));

  /** Select-all is page-scoped: it can only mean the rows you can see. */
  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) for (const i of items) next.delete(i.ratingKey);
      else for (const i of items) next.add(i.ratingKey);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sections = sectionsQuery.data ?? [];

  /**
   * Hand the current filters to the rule wizard.
   *
   * Browsing and authoring were separate acts — you found the set here, then
   * rebuilt it from memory in the wizard. The translation is lossy where Plex
   * has no equivalent field, so the losses are named before the wizard opens
   * rather than discovered later by a rule that matches too much.
   */
  function createRule() {
    const seed = ruleSeedFromView(
      {
        sections: sectionFilter,
        types: typeFilter,
        search,
        resolutions: resFilter,
        videoCodecs: vcodecFilter,
        audioCodecs: acodecFilter,
        audioChannels: achFilter,
        containers: containerFilter,
        labels: labelFilter,
      },
      (key) => sections.find((s) => s.key === key)?.title ?? null,
    );
    const warning = describeDropped(seed.dropped);
    if (warning) addToast(warning, "info", 10000);
    navigate("/rules", { state: { ruleSeed: seed } });
  }

  /**
   * Add and remove labels across the selection.
   *
   * The mutation reads each item before writing it, so this is one request
   * that takes a while rather than fifty that race — the bar reports progress
   * by going busy rather than by counting, because the server does the loop.
   */
  async function applyLabels({ add, remove }: { add: string[]; remove: Set<string> }) {
    const ratingKeys = [...selected];
    setLabelsOpen(false);
    setBulkBusy("Applying labels");
    try {
      const result = await bulkTagsMutation.mutateAsync({
        ratingKeys,
        field: "label",
        add,
        remove: [...remove],
      });
      const failed = result.failures.length;
      addToast(
        `${result.changed} item${result.changed === 1 ? "" : "s"} relabelled` +
          (failed > 0 ? `, ${failed} failed` : "") +
          (result.changed > 0 ? " — undo from Settings → Metadata" : ""),
        failed > 0 ? "error" : "success",
      );
      setSelected(new Set());
      // The server writes the new labels through to the index, so both the rows
      // and the filter's options are already current on refetch.
      await Promise.all([utils.media.list.invalidate(), utils.media.labels.invalidate()]);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to apply labels", "error");
    } finally {
      setBulkBusy(null);
    }
  }

  async function refreshSelected() {
    const ratingKeys = [...selected];
    setBulkBusy("Refreshing");
    try {
      const result = await bulkRefreshMutation.mutateAsync({ ratingKeys });
      const failed = result.failures.length;
      addToast(
        `Asked Plex to refresh ${result.refreshed} item${result.refreshed === 1 ? "" : "s"}` +
          (failed > 0 ? `, ${failed} failed` : ""),
        failed > 0 ? "error" : "success",
      );
      setSelected(new Set());
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to refresh", "error");
    } finally {
      setBulkBusy(null);
    }
  }

  if (mediaQuery.isLoading && !mediaQuery.data) return <MediaSkeleton />;
  if (mediaQuery.error && !mediaQuery.data) {
    return <ErrorState title="Couldn't load media" error={mediaQuery.error} onRetry={() => mediaQuery.refetch()} />;
  }

  return (
    <PageShell count={total > 0 ? total.toLocaleString() : undefined}>
      <div className={styles.filters}>
        <SearchInput
          placeholder="Search media…"
          ariaLabel="Search media"
          value={search}
          onChange={(v) => setParam("q", v)}
        />
        <MultiSelect
          allLabel="All sections"
          ariaLabel="Filter by library section"
          options={sections.map((s) => ({ value: s.key, label: s.title }))}
          selected={sectionFilter}
          onChange={(next) => setListParam("section", next)}
        />
        <MultiSelect
          allLabel="All types"
          ariaLabel="Filter by media type"
          options={TYPE_OPTIONS}
          selected={typeFilter}
          onChange={(next) => setListParam("type", next)}
        />
        {/* Hidden on a library with no labels rather than shown empty — unless
            the URL already carries one, so a shared link can still be undone. */}
        {(labelOptions.length > 0 || labelFilter.length > 0) && (
          <MultiSelect
            allLabel="Any label"
            ariaLabel="Filter by label"
            options={labelOptions}
            selected={labelFilter}
            onChange={(next) => setListParam("label", next)}
          />
        )}
        <button
          className={`${styles.advancedFilterToggle} ${showAdvanced ? styles.advancedFilterToggleActive : ""}`}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Filters
          {activeFilterCount > 0 && <span className={styles.advancedFilterBadge}>{activeFilterCount}</span>}
        </button>
        <div className={styles.filtersSpacer} />
        <SavedViews page="media" extraActions={[{ label: "Create rule from this view…", onSelect: createRule }]} />
        {viewMode === "table" && (
          <ColumnsButton
            all={ALL_COLUMNS}
            config={columnConfig}
            onChange={(next) => saveColumnsMutation.mutate(next)}
          />
        )}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => {
              setViewMode("table");
              writeStorage("media-view", "table");
            }}
          >
            Table
          </button>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => {
              setViewMode("grid");
              writeStorage("media-view", "grid");
            }}
          >
            Grid
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className={styles.advancedFilters}>
          <MultiSelect
            allLabel="Any resolution"
            options={RESOLUTION_OPTIONS}
            selected={resFilter}
            onChange={(next) => setListParam("res", next)}
          />
          <MultiSelect
            allLabel="Any video codec"
            options={VIDEO_CODEC_OPTIONS}
            selected={vcodecFilter}
            onChange={(next) => setListParam("vcodec", next)}
          />
          <MultiSelect
            allLabel="Any audio codec"
            options={AUDIO_CODEC_OPTIONS}
            selected={acodecFilter}
            onChange={(next) => setListParam("acodec", next)}
          />
          <MultiSelect
            allLabel="Any channels"
            options={AUDIO_CHANNELS_OPTIONS}
            selected={achFilter}
            onChange={(next) => setListParam("ach", next)}
          />
          <MultiSelect
            allLabel="Any container"
            options={CONTAINER_OPTIONS}
            selected={containerFilter}
            onChange={(next) => setListParam("container", next)}
          />
          {activeFilterCount > 0 && (
            <button className={styles.clearFilters} onClick={clearAdvancedFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon="film" title="No media items found" />
      ) : viewMode === "grid" ? (
        <div className={styles.grid}>
          {items.map((item) => (
            <div
              key={item.ratingKey}
              className={mediaStyles.cardSelectable}
              onClick={() => navigate(`/media/${item.ratingKey}`)}
            >
              <label className={mediaStyles.cardSelect} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(item.ratingKey)}
                  onChange={() => toggleSelected(item.ratingKey)}
                  aria-label={`Select ${item.title}`}
                />
              </label>
              {item.thumb ? (
                <FadeImage
                  className={styles.cardPoster}
                  src={plexImageUrl(item.thumb)}
                  alt={item.title}
                  loading="lazy"
                />
              ) : (
                <div className={styles.cardPosterPlaceholder}>No poster</div>
              )}
              <div className={styles.cardTitle} title={item.title}>
                {item.title}
              </div>
              <div className={styles.cardMeta}>{item.year ?? ""}</div>
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
                    checked={allOnPageSelected}
                    ref={(el) => {
                      // Some-but-not-all reads as indeterminate rather than as
                      // "nothing selected", which is what an unticked box says.
                      if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                    }}
                    onChange={toggleAllOnPage}
                    aria-label={allOnPageSelected ? "Deselect all on this page" : "Select all on this page"}
                  />
                </th>
                {visibleColumns.map((col) => (
                  <SortableTh key={col.id} sortKey={col.id} activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    {col.label}
                  </SortableTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isShow = item.type === "show";
                const isExpanded = expandedRows.has(item.ratingKey);
                return (
                  <React.Fragment key={item.ratingKey}>
                    <tr className={styles.clickableRow} onClick={() => navigate(`/media/${item.ratingKey}`)}>
                      <td className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(item.ratingKey)}
                          onChange={() => toggleSelected(item.ratingKey)}
                          aria-label={`Select ${item.title}`}
                        />
                      </td>
                      {visibleColumns.map((col, colIdx) => (
                        <td
                          key={col.id}
                          className={
                            col.id === "year"
                              ? `${styles.cellNum} ${styles.itemYear}`
                              : col.mono
                                ? styles.cellMuted
                                : undefined
                          }
                        >
                          {colIdx === 0 && isShow && (
                            <button
                              className={mediaStyles.expandToggle}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(item.ratingKey);
                              }}
                            >
                              {isExpanded ? "\u25BC" : "\u25B6"}
                            </button>
                          )}
                          {col.render(item)}
                        </td>
                      ))}
                    </tr>
                    {isShow && isExpanded && (
                      <ChildrenRows
                        parentRatingKey={item.ratingKey}
                        depth={1}
                        // +1 for the selection column.
                        colSpan={visibleColumns.length + 1}
                        visibleColumns={visibleColumns}
                        expandedRows={expandedRows}
                        toggleExpanded={toggleExpanded}
                        navigate={navigate}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} noun="items" onPageChange={setPage} />

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          noun="item"
          progress={bulkBusy ? { done: 0, total: 0, label: bulkBusy } : null}
          onClear={() => setSelected(new Set())}
          actions={[
            { label: "Edit labels…", onClick: () => setLabelsOpen(true), tone: "primary" },
            { label: "Refresh metadata", onClick: refreshSelected, title: "Ask Plex to re-run its agents" },
          ]}
        />
      )}

      {labelsOpen && (
        <BulkLabelsModal
          count={selected.size}
          noun="item"
          existingLabels={[]}
          freeTextRemove
          onApply={applyLabels}
          onCancel={() => setLabelsOpen(false)}
        />
      )}
    </PageShell>
  );
}
