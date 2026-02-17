import { useState, useCallback } from "react";
import { trpc } from "../trpc";
import styles from "./Overlays.module.css";

const POSITIONS = [
  { id: "top-left", label: "Top Left", className: styles.posTopLeft },
  { id: "top-center", label: "Top Center", className: styles.posTopCenter },
  { id: "top-right", label: "Top Right", className: styles.posTopRight },
  { id: "bottom-left", label: "Bottom Left", className: styles.posBottomLeft },
  { id: "bottom-center", label: "Bottom Center", className: styles.posBottomCenter },
  { id: "bottom-right", label: "Bottom Right", className: styles.posBottomRight },
] as const;

const OVERLAY_CHIPS = [
  { type: "resolution", label: "Resolution" },
  { type: "video_codec", label: "Video Codec" },
  { type: "audio_codec", label: "Audio Codec" },
  { type: "content_rating", label: "Content Rating" },
  { type: "imdb_rating", label: "IMDb Rating" },
  { type: "rt_rating", label: "RT Rating" },
] as const;

type OverlayType = (typeof OVERLAY_CHIPS)[number]["type"];

function getBadgeClass(type: string, value: string): string {
  switch (type) {
    case "resolution":
      if (value === "4K") return styles.badgeGold;
      if (value === "1080p") return styles.badgeBlue;
      if (value === "720p") return styles.badgeGreen;
      return styles.badgeGray;
    case "imdb_rating":
      return styles.badgeImdb;
    case "rt_rating":
      return styles.badgeRt;
    default:
      return styles.badgeDark;
  }
}

function getPlaceholderValue(type: string): string {
  switch (type) {
    case "resolution":
      return "4K";
    case "video_codec":
      return "H.265";
    case "audio_codec":
      return "Atmos";
    case "content_rating":
      return "PG-13";
    case "imdb_rating":
      return "IMDb 8.5";
    case "rt_rating":
      return "RT 95%";
    default:
      return type;
  }
}

export default function Overlays() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<string | null>(null);
  const [testImage, setTestImage] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });

  // Filter to movie/show sections only
  const sections = (sectionsQuery.data || []).filter((s) => s.type === "movie" || s.type === "show");

  // Auto-select first section
  const sectionId = activeSection || sections[0]?.key || "";

  const configsQuery = trpc.overlays.configs.useQuery(
    { sectionId },
    { enabled: !!sectionId, refetchOnWindowFocus: false },
  );

  const statusQuery = trpc.overlays.status.useQuery({ sectionId }, { enabled: !!sectionId });

  const sampleQuery = trpc.overlays.sampleItem.useQuery(
    { sectionId },
    { enabled: !!sectionId, refetchOnWindowFocus: false },
  );

  const previewQuery = trpc.overlays.previewValues.useQuery(
    { sectionId, ratingKey: sampleQuery.data?.ratingKey || "" },
    { enabled: !!sectionId && !!sampleQuery.data?.ratingKey, refetchOnWindowFocus: false },
  );

  const setConfigMutation = trpc.overlays.setConfig.useMutation({
    onSuccess: () => {
      utils.overlays.configs.invalidate({ sectionId });
      if (sampleQuery.data?.ratingKey) {
        utils.overlays.previewValues.invalidate({ sectionId, ratingKey: sampleQuery.data.ratingKey });
      }
    },
  });

  const removeConfigMutation = trpc.overlays.removeConfig.useMutation({
    onSuccess: () => {
      utils.overlays.configs.invalidate({ sectionId });
      if (sampleQuery.data?.ratingKey) {
        utils.overlays.previewValues.invalidate({ sectionId, ratingKey: sampleQuery.data.ratingKey });
      }
    },
  });

  const startJobMutation = trpc.jobs.start.useMutation();

  const testOverlayMutation = trpc.overlays.testOverlay.useMutation({
    onSuccess: (data) => {
      setTestImage(`data:image/jpeg;base64,${data.image}`);
    },
  });

  const configs = configsQuery.data || [];
  const previewValues = previewQuery.data || {};

  // Build a position → config map
  const configByPosition = new Map(configs.map((c) => [c.position, c]));

  // Build a set of used overlay types
  const usedTypes = new Set(configs.map((c) => c.overlayType));

  const handleDrop = useCallback(
    (position: string, overlayType: string) => {
      setDragOverPosition(null);
      setConfigMutation.mutate({
        sectionId,
        position,
        overlayType,
      });
    },
    [sectionId, setConfigMutation],
  );

  const handleRemove = useCallback(
    (position: string) => {
      removeConfigMutation.mutate({ sectionId, position });
    },
    [sectionId, removeConfigMutation],
  );

  const handleShuffle = () => {
    utils.overlays.sampleItem.invalidate({ sectionId });
  };

  const plexUrl = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const baseUrl = plexUrl.data?.global_plex_url || "";
  const plexToken = plexUrl.data?.global_plex_token || "";

  const posterUrl =
    sampleQuery.data?.thumb && baseUrl ? `${baseUrl}${sampleQuery.data.thumb}?X-Plex-Token=${plexToken}` : null;

  if (sectionsQuery.isLoading) return <p>Loading...</p>;

  return (
    <div>
      <h2>Poster Overlays</h2>
      <p className={styles.description}>
        Add visual badges to your library posters showing resolution, codec, ratings, and more. Drag an overlay type
        onto a position on the poster preview, then run the Apply Overlays job.
      </p>

      {sections.length === 0 ? (
        <p>No movie or TV libraries found. Configure your Plex libraries in Settings.</p>
      ) : (
        <>
          <nav className={styles.tabs}>
            {sections.map((s) => (
              <button
                key={s.key}
                className={`${styles.tab} ${sectionId === s.key ? styles.tabActive : ""}`}
                onClick={() => setActiveSection(s.key)}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div className={styles.overlayEditor}>
            {/* Left: Poster preview with drop zones */}
            <div className={styles.posterPreview}>
              <div className={styles.posterContainer}>
                {posterUrl ? (
                  <img src={posterUrl} className={styles.posterImage} alt="Sample poster" />
                ) : (
                  <div className={styles.posterPlaceholder}>No poster</div>
                )}

                {POSITIONS.map((pos) => {
                  const config = configByPosition.get(pos.id);
                  const value =
                    (previewValues as Record<string, string | null>)[pos.id] ||
                    (config ? getPlaceholderValue(config.overlayType) : null);
                  const isOver = dragOverPosition === pos.id;

                  return (
                    <div
                      key={pos.id}
                      className={`${styles.dropZone} ${pos.className} ${config ? styles.dropZoneAssigned : ""} ${isOver ? styles.dropZoneOver : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverPosition(pos.id);
                      }}
                      onDragLeave={() => setDragOverPosition(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        const type = e.dataTransfer.getData("text/plain");
                        if (type) handleDrop(pos.id, type);
                      }}
                    >
                      {config && value ? (
                        <span className={`${styles.badge} ${getBadgeClass(config.overlayType, value)}`}>
                          {value}
                          <button
                            className={styles.badgeRemove}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove(pos.id);
                            }}
                            title="Remove"
                          >
                            &times;
                          </button>
                        </span>
                      ) : (
                        <span className={styles.dropZonePlaceholder}>{pos.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={styles.posterMeta}>
                <span className={styles.posterTitle}>
                  {sampleQuery.data
                    ? `${sampleQuery.data.title}${sampleQuery.data.year ? ` (${sampleQuery.data.year})` : ""}`
                    : "Loading..."}
                </span>
                <button className={styles.shuffleBtn} onClick={handleShuffle} disabled={sampleQuery.isFetching}>
                  Shuffle
                </button>
                <button
                  className={styles.shuffleBtn}
                  onClick={() => {
                    if (sampleQuery.data?.ratingKey) {
                      testOverlayMutation.mutate({ sectionId, ratingKey: sampleQuery.data.ratingKey });
                    }
                  }}
                  disabled={!sampleQuery.data?.ratingKey || configs.length === 0 || testOverlayMutation.isPending}
                >
                  {testOverlayMutation.isPending ? "Rendering..." : "Test"}
                </button>
              </div>
            </div>

            {/* Right: Chip panel */}
            <div className={styles.chipPanel}>
              <h3 className={styles.chipPanelTitle}>Available Overlays</h3>
              <div className={styles.chipList}>
                {OVERLAY_CHIPS.map((chip) => {
                  const isUsed = usedTypes.has(chip.type);
                  return (
                    <div
                      key={chip.type}
                      className={`${styles.chip} ${isUsed ? styles.chipDisabled : ""}`}
                      draggable={!isUsed}
                      onDragStart={(e) => {
                        if (isUsed) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData("text/plain", chip.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      {chip.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={styles.statusBar}>
            <span className={styles.statusCount}>
              {statusQuery.data
                ? `${statusQuery.data.count} item${statusQuery.data.count === 1 ? "" : "s"} have overlays applied`
                : "Loading..."}
            </span>
            <button
              className={styles.statusBtn}
              onClick={() => startJobMutation.mutate({ jobId: "overlays" })}
              disabled={startJobMutation.isPending || configs.length === 0}
            >
              Apply Overlays
            </button>
            <button
              className={styles.statusBtnDanger}
              onClick={() => startJobMutation.mutate({ jobId: "overlays-remove" })}
              disabled={startJobMutation.isPending || (statusQuery.data?.count || 0) === 0}
            >
              Remove All Overlays
            </button>
          </div>
        </>
      )}

      {testImage && (
        <div className={styles.modalBackdrop} onClick={() => setTestImage(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Overlay Preview</h3>
              <button className={styles.modalClose} onClick={() => setTestImage(null)}>
                &times;
              </button>
            </div>
            <img src={testImage} className={styles.modalImage} alt="Overlay preview" />
            <p className={styles.modalHint}>This is a preview only — no changes have been made in Plex.</p>
          </div>
        </div>
      )}
    </div>
  );
}
