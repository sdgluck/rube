import BrowserFrame from "./BrowserFrame";
import { SHOTS_BY_SLUG } from "#data/content";
import styles from "./ScreenshotFigure.module.css";

/** A captured screenshot in a browser frame, with its caption underneath. */
export default function ScreenshotFigure({ slug, id }: { slug: string; id?: string }) {
  const shot = SHOTS_BY_SLUG[slug];
  return (
    <figure className={styles.figure} id={id}>
      <BrowserFrame url={`rube.local/${shot?.path ?? slug}`}>
        <img src={`/screenshots/${slug}.png`} alt={shot ? shot.title : slug} loading="lazy" />
      </BrowserFrame>
      {shot && (
        <figcaption className={styles.caption}>
          <strong>{shot.title}.</strong> {shot.caption}
        </figcaption>
      )}
    </figure>
  );
}
