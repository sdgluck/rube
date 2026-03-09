import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "../trpc";
import { MediaSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import styles from "./Collections.module.css";
import mediaStyles from "./Media.module.css";

type ViewMode = "table" | "grid";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "movie", label: "Movies" },
  { value: "show", label: "Shows" },
  { value: "artist", label: "Music" },
  { value: "photo", label: "Photos" },
];

const RESOLUTION_OPTIONS = [
  { value: "", label: "Any resolution" },
  { value: "4k", label: "4K" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "sd", label: "SD" },
];

const VIDEO_CODEC_OPTIONS = [
  { value: "", label: "Any video codec" },
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "vp9", label: "VP9" },
  { value: "av1", label: "AV1" },
  { value: "mpeg4", label: "MPEG-4" },
  { value: "vc1", label: "VC-1" },
];

const AUDIO_CODEC_OPTIONS = [
  { value: "", label: "Any audio codec" },
  { value: "aac", label: "AAC" },
  { value: "ac3", label: "AC3 / Dolby Digital" },
  { value: "eac3", label: "EAC3 / Dolby Digital+" },
  { value: "dca", label: "DTS" },
  { value: "truehd", label: "TrueHD" },
  { value: "flac", label: "FLAC" },
];

const AUDIO_CHANNELS_OPTIONS = [
  { value: "", label: "Any channels" },
  { value: "8", label: "7.1" },
  { value: "6", label: "5.1" },
  { value: "2", label: "Stereo" },
  { value: "1", label: "Mono" },
];

const CONTAINER_OPTIONS = [
  { value: "", label: "Any container" },
  { value: "mkv", label: "MKV" },
  { value: "mp4", label: "MP4" },
  { value: "avi", label: "AVI" },
];

const ADVANCED_FILTER_KEYS = ["res", "vcodec", "acodec", "ach", "container"] as const;

const PAGE_SIZE = 50;

type SortKey =
  | "title"
  | "section"
  | "type"
  | "year"
  | "resolution"
  | "videoCodec"
  | "audioCodec"
  | "audioChannels"
  | "container";
type SortDir = "asc" | "desc";
const VALID_SORT_KEYS: Set<string> = new Set([
  "title",
  "section",
  "type",
  "year",
  "resolution",
  "videoCodec",
  "audioCodec",
  "audioChannels",
  "container",
]);

interface ColumnDef {
  id: string;
  label: string;
  render: (item: MediaItem) => string;
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
  { id: "title", label: "Title", render: (item) => item.title },
  { id: "section", label: "Section", render: (item) => item.sectionTitle },
  { id: "type", label: "Type", render: (item) => item.type },
  { id: "year", label: "Year", render: (item) => (item.year ? String(item.year) : "\u2014") },
  { id: "resolution", label: "Resolution", render: (item) => item.videoResolution?.toUpperCase() || "\u2014" },
  { id: "videoCodec", label: "Video Codec", render: (item) => item.videoCodec?.toUpperCase() || "\u2014" },
  { id: "audioCodec", label: "Audio Codec", render: (item) => item.audioCodec?.toUpperCase() || "\u2014" },
  {
    id: "audioChannels",
    label: "Channels",
    render: (item) =>
      item.audioChannels ? AUDIO_CHANNELS_LABELS[item.audioChannels] || String(item.audioChannels) : "\u2014",
  },
  { id: "container", label: "Container", render: (item) => item.container?.toUpperCase() || "\u2014" },
];

const DEFAULT_COLUMNS = ALL_COLUMNS.map((col) => ({
  id: col.id,
  visible: ["title", "section", "type", "year"].includes(col.id),
}));

type ColumnConfig = { id: string; visible: boolean };

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
          Loading...
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
                  <td key={col.id} className={colIdx === 0 ? mediaStyles.childRowDepth2 : undefined}>
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
                      <span style={{ color: "#999", marginLeft: 6, fontSize: "0.85em" }}>
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

  const sectionFilter = searchParams.get("section") ?? "";
  const typeFilter = searchParams.get("type") ?? "";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("media-view") as ViewMode) || "table");
  const [showAdvanced, setShowAdvanced] = useState(() => ADVANCED_FILTER_KEYS.some((k) => searchParams.has(k)));
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem("media-sort-key");
    return stored && VALID_SORT_KEYS.has(stored) ? (stored as SortKey) : "title";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const stored = localStorage.getItem("media-sort-dir");
    return stored === "desc" ? "desc" : "asc";
  });

  const resFilter = searchParams.get("res") ?? "";
  const vcodecFilter = searchParams.get("vcodec") ?? "";
  const acodecFilter = searchParams.get("acodec") ?? "";
  const achFilter = searchParams.get("ach") ?? "";
  const containerFilter = searchParams.get("container") ?? "";

  const activeFilterCount = [resFilter, vcodecFilter, acodecFilter, achFilter, containerFilter].filter(Boolean).length;

  // Column configuration
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const columnConfigRef = useRef<HTMLDivElement>(null);
  const columnsQuery = trpc.media.columns.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveColumnsMutation = trpc.media.saveColumns.useMutation({
    onSuccess: () => columnsQuery.refetch(),
  });

  const columnConfig: ColumnConfig[] = columnsQuery.data ?? DEFAULT_COLUMNS;

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
          // Reset page when filters change
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      const next = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      localStorage.setItem("media-sort-dir", next);
    } else {
      setSortKey(key);
      setSortDir("asc");
      localStorage.setItem("media-sort-key", key);
      localStorage.setItem("media-sort-dir", "asc");
    }
    // Reset to first page on sort change
    setParam("page", "");
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when debounced search changes
  useEffect(() => {
    if (page > 1 && debouncedSearch !== (searchParams.get("q") ?? "")) {
      setParam("page", "");
    }
  }, [debouncedSearch]);

  const offset = (page - 1) * PAGE_SIZE;

  const mediaQuery = trpc.media.list.useQuery(
    {
      sectionId: sectionFilter || undefined,
      type: typeFilter || undefined,
      search: debouncedSearch || undefined,
      offset,
      limit: PAGE_SIZE,
      videoResolution: resFilter || undefined,
      videoCodec: vcodecFilter || undefined,
      audioCodec: acodecFilter || undefined,
      audioChannels: achFilter ? Number(achFilter) : undefined,
      container: containerFilter || undefined,
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
  if (mediaQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load media</div>;

  return (
    <div>
      <h2 className={styles.heading}>Media{total > 0 && <span className="count-badge">{total}</span>}</h2>

      <div className={styles.filters}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search media..."
          value={search}
          onChange={(e) => setParam("q", e.target.value)}
        />
        <select className={styles.select} value={sectionFilter} onChange={(e) => setParam("section", e.target.value)}>
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
        <select className={styles.select} value={typeFilter} onChange={(e) => setParam("type", e.target.value)}>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
              localStorage.setItem("media-view", "table");
            }}
          >
            Table
          </button>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => {
              setViewMode("grid");
              localStorage.setItem("media-view", "grid");
            }}
          >
            Grid
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className={styles.advancedFilters}>
          <select className={styles.select} value={resFilter} onChange={(e) => setParam("res", e.target.value)}>
            {RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={vcodecFilter} onChange={(e) => setParam("vcodec", e.target.value)}>
            {VIDEO_CODEC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={acodecFilter} onChange={(e) => setParam("acodec", e.target.value)}>
            {AUDIO_CODEC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={achFilter} onChange={(e) => setParam("ach", e.target.value)}>
            {AUDIO_CHANNELS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={containerFilter}
            onChange={(e) => setParam("container", e.target.value)}
          >
            {CONTAINER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
                <img
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
                  <th key={col.id} className={styles.sortable} onClick={() => toggleSort(col.id as SortKey)}>
                    {col.label}
                    {sortIndicator(col.id as SortKey)}
                  </th>
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
                        <td key={col.id} className={col.id === "year" ? styles.itemYear : undefined}>
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

      {total > PAGE_SIZE && (
        <div className={styles.pagination}>
          <button
            className={styles.buttonSecondary}
            disabled={page <= 1}
            onClick={() => setParam("page", String(page - 1))}
          >
            Previous
          </button>
          <span className={styles.paginationInfo}>
            Page {page} of {totalPages} ({total} items)
          </span>
          <button
            className={styles.buttonSecondary}
            disabled={page >= totalPages}
            onClick={() => setParam("page", String(page + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
