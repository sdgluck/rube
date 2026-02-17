import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "../trpc";
import styles from "./Collections.module.css";

type ViewMode = "table" | "grid";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "movie", label: "Movies" },
  { value: "show", label: "Shows" },
  { value: "artist", label: "Music" },
  { value: "photo", label: "Photos" },
];

const PAGE_SIZE = 50;

export default function Media() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const sectionFilter = searchParams.get("section") ?? "";
  const typeFilter = searchParams.get("type") ?? "";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("media-view") as ViewMode) || "table");

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
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false });

  const items = mediaQuery.data?.items ?? [];
  const total = mediaQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sections = sectionsQuery.data ?? [];

  if (mediaQuery.isLoading && !mediaQuery.data) return <p>Loading...</p>;
  if (mediaQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load media</div>;

  return (
    <div>
      <h2 className={styles.heading}>Media</h2>

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
        <div className={styles.filtersSpacer} />
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

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No media items found.</p>
        </div>
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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Section</th>
              <th>Type</th>
              <th>Year</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.ratingKey}
                className={styles.clickableRow}
                onClick={() => navigate(`/media/${item.ratingKey}`)}
              >
                <td>{item.title}</td>
                <td>{item.sectionTitle}</td>
                <td>{item.type}</td>
                <td className={styles.itemYear}>{item.year || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
