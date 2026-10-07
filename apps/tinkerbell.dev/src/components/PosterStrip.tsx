import type { CSSProperties } from "react";
import { SITE_POSTERS } from "#data/posters";
import styles from "./PosterStrip.module.css";

/**
 * A fanned row of the demo library's posters, a few wearing badges the way
 * overlays would put them there. It's the site's one decorative element, and
 * it shows the product's own output instead of an illustration.
 */
export default function PosterStrip() {
  return (
    <div className={styles.strip} aria-hidden="true">
      {SITE_POSTERS.map((p, i) => (
        <div
          key={p.slug}
          className={styles.poster}
          style={{ "--i": i - (SITE_POSTERS.length - 1) / 2 } as CSSProperties}
        >
          <img src={`/posters/${p.slug}.png`} alt="" width={400} height={600} />
          {p.badge && <span className={styles.badge}>{p.badge}</span>}
        </div>
      ))}
    </div>
  );
}
