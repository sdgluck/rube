import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ScreenshotFigure from "#components/ScreenshotFigure";
import { FEATURE_GROUPS, FEATURES_BY_GROUP } from "#data/content";
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
        <h1>Features</h1>
        <p>What Tinkerbell does, with screenshots of the admin app where there's something to show.</p>
      </header>

      {FEATURE_GROUPS.map((g) => {
        // Features without a site capture go in a plain list under the
        // illustrated rows, rather than as rows with an empty half. The harness
        // seeds a demo library, not a busy one: the *Arr pages have no mock
        // *Arr behind them, and cleanup or the stress test would only show
        // their empty states.
        const shown = FEATURES_BY_GROUP[g.id].filter((f) => f.shot);
        const rest = FEATURES_BY_GROUP[g.id].filter((f) => !f.shot);
        return (
          <section key={g.id} id={g.id} className={styles.group}>
            <h2 className={styles.groupTitle}>{g.title}</h2>

            <div className={styles.rows}>
              {shown.map((f, i) => (
                <article key={f.id} id={f.id} className={styles.row} data-flip={i % 2 === 1}>
                  <div className={styles.copy}>
                    <h3>{f.title}</h3>
                    {f.stat && <span className="mono">{f.stat}</span>}
                    <p className={styles.body}>{f.body}</p>
                  </div>
                  <div className={styles.shot}>
                    <ScreenshotFigure slug={f.shot!} />
                  </div>
                </article>
              ))}
            </div>

            {rest.length > 0 && (
              <div className={styles.more}>
                {rest.map((f) => (
                  <article key={f.id} id={f.id} className={styles.item}>
                    <div className={styles.itemHead}>
                      <h3>{f.title}</h3>
                      {f.stat && <span className="mono">{f.stat}</span>}
                    </div>
                    <p className={styles.body}>{f.body}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
