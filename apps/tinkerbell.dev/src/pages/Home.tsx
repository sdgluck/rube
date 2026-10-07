import { Link } from "react-router-dom";
import GithubIcon from "#components/GithubIcon";
import CodeBlock from "#components/CodeBlock";
import PosterStrip from "#components/PosterStrip";
import ScreenshotFigure from "#components/ScreenshotFigure";
import { FEATURE_GROUPS, FEATURES_BY_GROUP, INSTALL_FACTS, GITHUB_URL } from "#data/content";
import styles from "./Home.module.css";

export default function Home() {
  return (
    <>
      <section className={`container ${styles.hero}`}>
        <h1 className={styles.title}>Rules for your Plex library.</h1>
        <p className={styles.lede}>
          Tinkerbell builds collections, overlays, playlists and prerolls from rules you write, clears out what nobody
          watches, and runs it all on a schedule. It runs on your own server.
        </p>
        <div className={styles.cta}>
          <a href="#install" className="btn btn-primary">
            Install
          </a>
          <Link to="/features" className="btn btn-ghost">
            All features
          </Link>
        </div>
      </section>

      <PosterStrip />

      <section className={`container ${styles.shot}`}>
        <ScreenshotFigure slug="collections" />
      </section>

      <section className={`container ${styles.section}`}>
        <h2 className={styles.sectionTitle}>What it does</h2>
        {FEATURE_GROUPS.map((g) => (
          <div key={g.id} className={styles.group}>
            <h3 className={styles.groupTitle}>{g.title}</h3>
            <ul className={styles.list}>
              {FEATURES_BY_GROUP[g.id].map((f) => (
                <li key={f.id}>
                  <Link to={`/features#${f.id}`} className={styles.item}>
                    <span className={styles.itemHead}>
                      <span className={styles.itemTitle}>{f.title}</span>
                      {f.stat && <span className="mono">{f.stat}</span>}
                    </span>
                    <span className={styles.itemBody}>{f.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section id="install" className={`container ${styles.section}`}>
        <div className={styles.install}>
          <div>
            <h2 className={styles.sectionTitle}>Install</h2>
            <p className={styles.installLede}>
              Run the image and open port 3000. A setup page walks you through connecting Plex.
            </p>
            <ul className={styles.facts}>
              {INSTALL_FACTS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <a href={GITHUB_URL} className="btn btn-ghost" target="_blank" rel="noreferrer">
              <GithubIcon size={16} /> Docs on GitHub
            </a>
          </div>
          <CodeBlock
            lines={[
              "docker run -d --name tinkerbell \\",
              "  -v /path/to/config:/config \\",
              "  -v /path/to/prerolls:/prerolls \\",
              "  -p 3000:3000 -p 3100:3100 \\",
              "  -e TZ=Europe/London \\",
              "  ghcr.io/sdgluck/tinkerbell:latest",
              "",
              "# then open http://<host>:3000",
            ]}
          />
        </div>
      </section>
    </>
  );
}
