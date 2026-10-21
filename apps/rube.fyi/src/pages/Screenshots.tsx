import ScreenshotFigure from "#components/ScreenshotFigure";
import { SHOTS } from "#data/content";
import styles from "./Screenshots.module.css";

export default function Screenshots() {
  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1>Screenshots</h1>
        <p>
          Captured from the running app by a test harness, against an invented demo library. The titles and posters are
          made up.
        </p>
      </header>

      <div className={styles.gallery}>
        {SHOTS.map((shot) => (
          <ScreenshotFigure key={shot.slug} slug={shot.slug} id={shot.slug} />
        ))}
      </div>
    </section>
  );
}
