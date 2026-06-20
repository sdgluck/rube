import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ScreenshotFigure from "#components/ScreenshotFigure";
import { FEATURES } from "#data/content";
import styles from "./Features.module.css";

export default function Features() {
  const { hash } = useLocation();

  // Deep-link support: scroll the targeted feature into view on load.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <span className="eyebrow">Features</span>
        <h1>Everything Tinkerbell automates</h1>
        <p>A closer look at each part of the curation pipeline, paired with a real screenshot of the admin UI.</p>
      </header>

      <div className={styles.rows}>
        {FEATURES.map((f, i) => (
          <article key={f.id} id={f.id} className={styles.row} data-flip={i % 2 === 1}>
            <div className={styles.copy}>
              <div className={styles.icon}>
                <f.icon size={22} />
              </div>
              <h2>{f.title}</h2>
              <p className={styles.tagline}>{f.tagline}</p>
              <p className={styles.body}>{f.body}</p>
            </div>
            <div className={styles.shot}>{f.shot && <ScreenshotFigure slug={f.shot} />}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
