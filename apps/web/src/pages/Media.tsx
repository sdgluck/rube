import React, { useState, useEffect, useCallback, useRef } from "react";
import { EMPTY } from "#/format";
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
import styles from "#/styles/shared.module.css";
import mediaStyles from "./Media.module.css";

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
] as const;
type SortKey = (typeof SORT_KEYS)[number];

interface ColumnDef {
  id: SortKey;
  label: string;
  /** ReactNode rather than string: "Added" renders a <RelativeTime>, which
      keeps itself current and carries the exact date in its tooltip. */
  render: (item: MediaItem) => React.ReactNode;
  /** File data the server reported — rendered in mono, like every other
      machine-produced value in the app. */
  mono?: boolean;
  /** Role this cell takes when the table becomes cards on mobile. Columns here
      are user-configurable, so the role travels with the column rather than
      being inferred from its position in the row. */
  mobile?: "title" | "meta" | "hide";
}

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
};

const AUDIO_CHANNELS_LABELS: Record<number, string> = {
  1: "Mono",
  2: "Stereo",
  6: "5.1",
  8: "7.1",
};

const ALL_COLUMNS: ColumnDef[] = [
  { id: "title", label: "Title", render: (item) => item.title, mobile: "title" },
  { id: "section", label: "Section", render: (item) => item.sectionTitle, mobile: "meta" },
  { id: "type", label: "Type", render: (item) => item.type, mobile: "meta" },
  { id: "year", label: "Year", render: (item) => (item.year ? String(item.year) : EMPTY), mono: true, mobile: "meta" },
  {
    id: "added",
    label: "Added",
    // Plex's addedAt is in seconds — see the schema note on the column.
    render: (item) => (item.addedAt ? <RelativeTime timestamp={item.addedAt} seconds /> : EMPTY),
    mono: true,
    mobile: "meta",
  },
  {
    id: "resolution",
    label: "Resolution",
    render: (item) => item.videoResolution?.toUpperCase() || EMPTY,
    mono: true,
    mobile: "hide",
  },
  {
    id: "videoCodec",
    label: "Video Codec",
    render: (item) => item.videoCodec?.toUpperCase() || EMPTY,
    mono: true,
    mobile: "hide",
  },
  {
    id: "audioCodec",
    label: "Audio Codec",
    render: (item) => item.audioCodec?.toUpperCase() || EMPTY,
    mono: true,
    mobile: "hide",
  },
  {
    id: "audioChannels",
    label: "Channels",
    render: (item) =>
      item.audioChannels ? AUDIO_CHANNELS_LABELS[item.audioChannels] || String(item.audioChannels) : EMPTY,
    mono: true,
    mobile: "hide",
  },
  {
    id: "container",
    label: "Container",
    render: (item) => item.container?.toUpperCase() || EMPTY,
    mono: true,
    mobile: "hide",
  },
];

const DEFAULT_VISIBLE = ["title", "section", "type", "year", "added"];

const DEFAULT_COLUMNS = ALL_COLUMNS.map((col) => ({
  id: col.id,
  visible: DEFAULT_VISIBLE.includes(col.id),
}));

type ColumnConfig = { id: string; visible: boolean };

/**
 * The saved column config, brought up to date with the columns we now ship.
 *
 * A saved config is a complete list, and both the table and the Columns
 * dropdown iterate it rather than ALL_COLUMNS — so a column added after
 * someone last saved would be invisible *and* absent from the control that
 * turns it on. Missing columns are appended at their default visibility, which
 * keeps the order and the choices they made and still shows them the new
 * column. Columns we have dropped fall away by not being in ALL_COLUMNS.
 */
function reconcileColumns(saved: ColumnConfig[] | null | undefined): ColumnConfig[] {
  if (!saved || saved.length === 0) return DEFAULT_COLUMNS;
  const known = new Set(ALL_COLUMNS.map((c) => c.id as string));
  const kept = saved.filter((c) => known.has(c.id));
  const seen = new Set(kept.map((c) => c.id));
  return [...kept, ...DEFAULT_COLUMNS.filter((c) => !seen.has(c.id)).map((c) => ({ id: c.id, visible: c.visible }))];
}

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
  visibleColumns: ColumnDef[];
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
              {isEpisode ? (
                visibleColumns.map((col, colIdx) => (
                  <td
                    key={col.id}
                    data-cell={col.mobile ?? "meta"}
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

  const { sortKey, sortDir, page, listParam, setParam, setListParam, setPage, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "title",
    // "Newest first" is the only reason anyone sorts by when something arrived.
    descFirst: ["year", "added"],
  });

  const sectionFilter = listParam("section");
  const typeFilter = listParam("type");
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

  // Column configuration
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const columnConfigRef = useRef<HTMLDivElement>(null);
  const columnsQuery = trpc.media.columns.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveColumnsMutation = trpc.media.saveColumns.useMutation({
    onSuccess: () => columnsQuery.refetch(),
  });

  const columnConfig: ColumnConfig[] = reconcileColumns(columnsQuery.data);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const visibleColumns = columnConfig
    .filter((c) => c.visible)
    .map((c) => ALL_COLUMNS.find((col) => col.id === c.id)!)
    .filter(Boolean);

  // Close column config dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (columnConfigRef.current && !columnConfigRef.current.contains(e.target as Node)) {
        setShowColumnConfig(false);
      }
    }
    if (showColumnConfig) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showColumnConfig]);

  function toggleColumn(id: string) {
    const next = columnConfig.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
    saveColumnsMutation.mutate(next);
  }

  function moveColumn(from: number, to: number) {
    if (from === to) return;
    const next = [...columnConfig];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveColumnsMutation.mutate(next);
  }

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
      sort: sortKey,
      sortDir,
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false });

  const items = mediaQuery.data?.items ?? [];
  const total = mediaQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sections = sectionsQuery.data ?? [];

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
        <button
          className={`${styles.advancedFilterToggle} ${showAdvanced ? styles.advancedFilterToggleActive : ""}`}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Filters
          {activeFilterCount > 0 && <span className={styles.advancedFilterBadge}>{activeFilterCount}</span>}
        </button>
        <div className={styles.filtersSpacer} />
        {viewMode === "table" && (
          <div className={mediaStyles.columnConfigWrapper} ref={columnConfigRef}>
            <button
              className={`${mediaStyles.columnConfigBtn} ${showColumnConfig ? mediaStyles.columnConfigBtnActive : ""}`}
              onClick={() => setShowColumnConfig((v) => !v)}
            >
              Columns
            </button>
            {showColumnConfig && (
              <div className={mediaStyles.columnConfigDropdown}>
                {columnConfig.map((col, i) => {
                  const def = ALL_COLUMNS.find((c) => c.id === col.id);
                  if (!def) return null;
                  return (
                    <div
                      key={col.id}
                      className={`${mediaStyles.columnConfigItem} ${dragIndex === i ? mediaStyles.columnConfigItemDragging : ""}`}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null && dragIndex !== i) {
                          moveColumn(dragIndex, i);
                          setDragIndex(i);
                        }
                      }}
                      onDragEnd={() => setDragIndex(null)}
                    >
                      <span className={mediaStyles.dragHandle}>&#x2630;</span>
                      <label className={mediaStyles.columnConfigLabel}>
                        <input type="checkbox" checked={col.visible} onChange={() => toggleColumn(col.id)} />
                        {def.label}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
            <div key={item.ratingKey} className={styles.card} onClick={() => navigate(`/media/${item.ratingKey}`)}>
              {item.thumb ? (
                <FadeImage
                  className={styles.cardPoster}
                  src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
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
                      {visibleColumns.map((col, colIdx) => (
                        <td
                          key={col.id}
                          data-cell={col.mobile ?? "meta"}
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
                        colSpan={visibleColumns.length}
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
    </PageShell>
  );
}
