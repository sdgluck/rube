import { Link } from "react-router-dom";
import { REGISTRY, requirementsForPack, rulesForPack } from "#registry/index";
import { REQUIREMENT_LABELS } from "#registry/labels";
import styles from "./Registry.module.css";

export default function Registry() {
  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <span className="eyebrow">Registry</span>
        <h1>Rule packs, ready to import</h1>
        <p>
          Curated sets of Tinkerbell rules you can pull straight into your instance — no copying JSON around. Browse
          here, then import from <strong>Registry</strong> in your Tinkerbell admin UI.
        </p>
      </header>

      <div className={styles.grid}>
        {REGISTRY.packs.map((pack) => {
          const rules = rulesForPack(pack.slug);
          const requirements = requirementsForPack(pack.slug);
          return (
            <Link key={pack.slug} to={`/registry/${pack.slug}`} className={styles.card}>
              <h2>{pack.title}</h2>
              <p className={styles.tagline}>{pack.tagline}</p>
              <p className={styles.body}>{pack.description}</p>
              <div className={styles.meta}>
                <span className={styles.count}>
                  {rules.length} rule{rules.length === 1 ? "" : "s"}
                </span>
                {requirements.map((req) => (
                  <span key={req} className={styles.req}>
                    needs {REQUIREMENT_LABELS[req] ?? req}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
