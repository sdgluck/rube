import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";
import BrowserFrame from "#components/BrowserFrame";
import GithubIcon from "#components/GithubIcon";
import CodeBlock from "#components/CodeBlock";
import { FEATURES, STACK_BULLETS, GITHUB_URL } from "#data/content";
import styles from "./Home.module.css";

export default function Home() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className="container">
          <span className="eyebrow">Self-hosted Plex companion</span>
          <h1 className={styles.title}>
            Automate your Plex library
            <span className={styles.titleAccent}> the way you want it.</span>
          </h1>
          <p className={styles.lede}>
            Tinkerbell turns rules over your media into collections, poster overlays, personalized home screens, and
            notifications — refreshed on a schedule, with full run history. You host it; your data never leaves your
            server.
          </p>
          <div className={styles.cta}>
            <a href="#install" className="btn btn-primary">
              <Terminal size={17} /> Get started
            </a>
            <Link to="/screenshots" className="btn btn-ghost">
              See it in action <ArrowRight size={16} />
            </Link>
          </div>

          <div className={styles.heroShot}>
            <BrowserFrame url="tinkerbell.local/overlays">
              <img src="/screenshots/overlays.png" alt="Tinkerbell overlay editor" />
            </BrowserFrame>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className={`container ${styles.section}`}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">What it does</span>
          <h2>One control plane for your whole library</h2>
          <p>Six building blocks that compose into a curation pipeline you fully control.</p>
        </div>
        <div className={styles.grid}>
          {FEATURES.map((f) => (
            <article key={f.id} className={styles.card}>
              <div className={styles.cardIcon}>
                <f.icon size={20} />
              </div>
              <h3>{f.title}</h3>
              <p className={styles.cardTagline}>{f.tagline}</p>
              <p className={styles.cardBody}>{f.body}</p>
              {f.shot && (
                <Link to={`/features#${f.id}`} className={styles.cardLink}>
                  See screenshot <ArrowRight size={14} />
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ── Install ──────────────────────────────────────────────────── */}
      <section id="install" className={`container ${styles.section}`}>
        <div className={styles.installWrap}>
          <div>
            <span className="eyebrow">Run it yourself</span>
            <h2>Up and running in minutes</h2>
            <p className={styles.installLede}>
              Tinkerbell is a pnpm monorepo backed by SQLite, with a Docker image for the one-command path. It binds to
              loopback by default and exposes the user portal separately, so it's safe to put behind your reverse proxy.
            </p>
            <ul className={styles.bullets}>
              {STACK_BULLETS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <a href={GITHUB_URL} className="btn btn-ghost" target="_blank" rel="noreferrer">
              <GithubIcon size={16} /> Read the docs on GitHub
            </a>
          </div>
          <CodeBlock
            lines={[
              "# Clone and start the dev stack",
              "git clone https://github.com/sdgluck/tinkerbell",
              "cd tinkerbell && pnpm install",
              "pnpm dev",
              "",
              "# …or run the published Docker image",
              "docker run -p 3000:3000 -p 3100:3100 \\",
              "  -v ./data:/data ghcr.io/sdgluck/tinkerbell",
            ]}
          />
        </div>
      </section>
    </>
  );
}
