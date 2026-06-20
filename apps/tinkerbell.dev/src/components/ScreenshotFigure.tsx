import BrowserFrame from "./BrowserFrame";
import { SHOTS_BY_SLUG } from "#data/content";
import styles from "./ScreenshotFigure.module.css";

/**
 * Renders a captured screenshot inside a browser frame with a caption. Falls
 * back to a placeholder block until the harness has produced the PNG.
 */
export default function ScreenshotFigure({ slug, id }: { slug: string; id?: string }) {
  const shot = SHOTS_BY_SLUG[slug];
  return (
    <figure className={styles.figure} id={id}>
      <BrowserFrame url={`tinkerbell.local/${slug === "collections" ? "collections" : slug}`}>
        <img src={`/screenshots/${slug}.png`} alt={shot ? shot.title : slug} loading="lazy" />
      </BrowserFrame>
      {shot && (
        <figcaption className={styles.caption}>
          <strong>{shot.title}</strong> — {shot.caption}
        </figcaption>
      )}
    </figure>
  );
}
