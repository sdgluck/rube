import { Link, useParams } from "react-router-dom";
import CodeBlock from "#components/CodeBlock";
import { PACKS_BY_SLUG, requirementsForPack, rulesForPack } from "#registry/index";
import { REQUIREMENT_LABELS, RULE_TYPE_LABELS } from "#registry/labels";
import styles from "./RegistryPack.module.css";

export default function RegistryPack() {
  const { slug = "" } = useParams();
  const pack = PACKS_BY_SLUG.get(slug);

  if (!pack) {
    return (
      <section className={`container ${styles.page}`}>
        <header className={styles.head}>
          <h1>Pack not found</h1>
          <p>
            No pack with the slug <code>{slug}</code>. <Link to="/registry">Back to the registry</Link>.
          </p>
        </header>
      </section>
    );
  }

  const rules = rulesForPack(pack.slug);
  const requirements = requirementsForPack(pack.slug);

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <Link to="/registry" className={styles.back}>
          ← Registry
        </Link>
        <span className="eyebrow">Pack</span>
        <h1>{pack.title}</h1>
        <p className={styles.tagline}>{pack.tagline}</p>
        <p className={styles.body}>{pack.description}</p>
        {requirements.length > 0 && (
          <p className={styles.requires}>
            Needs {requirements.map((r) => REQUIREMENT_LABELS[r] ?? r).join(", ")} configured on your instance. Rules
            whose integration is missing still import — they just won't produce anything until it's set up.
          </p>
        )}
      </header>

      <div className={styles.howto}>
        <h2>Importing</h2>
        <p>
          Open <strong>Registry</strong> in your Tinkerbell admin UI, pick this pack, and choose which libraries to
          import it into. Tinkerbell rewrites each rule for your server — genre and studio filters are matched against
          your own Plex tags — and creates the rules disabled so you can review them first.
        </p>
        <p className={styles.direct}>
          Or fetch the pack directly:
          <CodeBlock lines={[`curl https://tinkerbell.dev/registry/packs/${pack.slug}.json`]} />
        </p>
      </div>

      <h2 className={styles.rulesHeading}>
        {rules.length} rule{rules.length === 1 ? "" : "s"} in this pack
      </h2>
      <ul className={styles.rules}>
        {rules.map((rule) => (
          <li key={rule.slug} className={styles.rule}>
            <div className={styles.ruleHead}>
              <h3>{rule.name}</h3>
              <span className={styles.type}>{RULE_TYPE_LABELS[rule.type] ?? rule.type}</span>
            </div>
            <p>{rule.description}</p>
            <div className={styles.ruleMeta}>
              {rule.mediaTypes.length === 1 && (
                <span className={styles.chip}>{rule.mediaTypes[0] === "movie" ? "Movies only" : "TV only"}</span>
              )}
              {rule.requires.map((req) => (
                <span key={req} className={styles.chip}>
                  needs {REQUIREMENT_LABELS[req] ?? req}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
