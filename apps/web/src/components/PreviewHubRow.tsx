import type { ReactNode } from "react";
import FadeImage from "#components/FadeImage";
import styles from "#pages/Preview.module.css";
import { plexImageUrl } from "#lib/media";

/**
 * Shared building block for Plex-style hub rows.
 *
 * Used by:
 *   • the Preview page (one row per home hub)
 *   • the Rules page inline preview (one row per matched collection)
 *
 * Both surfaces render identical card geometry, typography and skeletons —
 * the outer dark canvas is provided by each page since the surrounding
 * layout differs (full-bleed vs. table-row inset).
 */

export interface HubItem {
  ratingKey: string;
  title: string;
  type?: string;
  year?: number;
  thumb?: string;
  art?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  librarySectionTitle?: string;
}

interface PreviewHubRowProps {
  title?: string;
  /** Rendered inline next to the title — typically chips / actions. */
  chips?: ReactNode;
  items: HubItem[];
  /** 16:9 art-style cards (Continue Watching / On Deck) instead of 2:3 posters. */
  wide?: boolean;
  onItemClick?: (item: HubItem) => void;
}

export function PreviewHubRow({ title, chips, items, wide = false, onItemClick }: PreviewHubRowProps) {
  return (
    <section className={styles.hub}>
      {(title || chips) && (
        <h3 className={styles.hubTitle}>
          {title}
          {chips}
        </h3>
      )}
      <div className={styles.row}>
        {items.map((item) => (
          <Card key={item.ratingKey} item={item} wide={wide} onClick={onItemClick} />
        ))}
      </div>
    </section>
  );
}

interface PreviewHubRowSkeletonProps {
  wide?: boolean;
  cards?: number;
  /** Render a placeholder title bar. Set to false for sections that supply their own. */
  showTitle?: boolean;
}

export function PreviewHubRowSkeleton({ wide = false, cards = 8, showTitle = true }: PreviewHubRowSkeletonProps) {
  return (
    <section className={styles.hub} aria-hidden="true">
      {showTitle && <div className={styles.skeletonHubTitle} />}
      <div className={styles.row}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className={`${styles.skeletonCard} ${wide ? styles.cardWide : ""}`} />
        ))}
      </div>
    </section>
  );
}

function Card({ item, wide, onClick }: { item: HubItem; wide: boolean; onClick?: (item: HubItem) => void }) {
  const path = wide ? pickWideArtPath(item) : pickPosterPath(item);
  const src = path ? plexImageUrl(path) : null;
  const progress =
    item.viewOffset && item.duration && item.duration > 0 ? Math.min(1, item.viewOffset / item.duration) : 0;
  const displayTitle = item.type === "episode" && item.grandparentTitle ? item.grandparentTitle : item.title;
  const meta =
    item.type === "episode"
      ? item.parentIndex != null && item.index != null
        ? `S${item.parentIndex} · E${item.index} · ${item.title}`
        : item.title
      : (item.year ?? item.librarySectionTitle ?? "");
  return (
    <div className={`${styles.mediaCard} ${wide ? styles.cardWide : ""}`} onClick={() => onClick?.(item)}>
      <div className={styles.posterWrap}>
        {src ? (
          <FadeImage className={styles.poster} src={src} alt={item.title} loading="lazy" />
        ) : (
          <div className={styles.posterPlaceholder}>No image</div>
        )}
        {progress > 0 && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <div className={styles.cardTitle} title={item.title}>
        {displayTitle}
      </div>
      <div className={styles.cardMeta}>{meta}</div>
    </div>
  );
}

function pickPosterPath(item: HubItem): string | undefined {
  // Episodes look best with the show poster (grandparentThumb) — matches Plex.
  if (item.type === "episode") return item.grandparentThumb || item.parentThumb || item.thumb;
  if (item.type === "season") return item.parentThumb || item.thumb;
  return item.thumb;
}

function pickWideArtPath(item: HubItem): string | undefined {
  if (item.type === "episode") return item.thumb || item.art;
  return item.art || item.thumb;
}
