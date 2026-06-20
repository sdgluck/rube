import { Link } from "react-router-dom";
import { GITHUB_URL } from "#data/content";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span>Tinkerbell</span>
          <span className={styles.version}>v{__APP_VERSION__}</span>
        </div>
        <nav className={styles.links}>
          <Link to="/features">Features</Link>
          <Link to="/screenshots">Screenshots</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <p className={styles.note}>Self-hosted Plex library automation. Not affiliated with Plex, Inc.</p>
      </div>
    </footer>
  );
}
