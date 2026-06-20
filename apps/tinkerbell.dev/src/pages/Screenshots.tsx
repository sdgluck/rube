import ScreenshotFigure from "#components/ScreenshotFigure";
import { SHOTS } from "#data/content";
import styles from "./Screenshots.module.css";

export default function Screenshots() {
  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <span className="eyebrow">Screenshots</span>
        <h1>A tour of the admin UI</h1>
        <p>
          Every image below is a real capture of the running app, taken by an automated browser harness against
          synthetic demo data.
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
