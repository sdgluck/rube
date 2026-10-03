import styles from "./Onboarding.module.css";

/**
 * The concepts tour.
 *
 * Deliberately first, and deliberately free of inputs: the next step asks for
 * a token that can rewrite someone's whole library, and it's fairer to explain
 * what the thing does — and what it won't do without being told — before
 * asking for that than after.
 */
/**
 * One line per concept, and each fact said here once: the later steps used
 * to open with ledes that repeated these ("rules arrive disabled", "nothing
 * here is one-time"), so by the third step the setup was mostly reassurance.
 */
const CONCEPTS = [
  {
    title: "Rules build collections",
    body: "Each rule keeps a Plex collection in step with a question about your library.",
  },
  {
    title: "Jobs run them on a schedule",
    body: "Rules run on a schedule, not when you save them.",
  },
  {
    title: "Nothing happens until you enable it",
    body: "Rules arrive disabled; dry-run any of them first, and revert any run.",
  },
  {
    title: "Cleanup is separate, and off",
    body: "Deleting media has its own switch. Nothing in this setup turns it on.",
  },
];

export default function WelcomeStep() {
  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Welcome to Tinkerbell</h2>
      <div className={styles.conceptGrid}>
        {CONCEPTS.map((concept) => (
          <div key={concept.title} className={styles.concept}>
            <h3 className={styles.conceptTitle}>{concept.title}</h3>
            <p className={styles.conceptBody}>{concept.body}</p>
          </div>
        ))}
      </div>
      <p className={styles.fieldHint}>
        Progress saves as you go, and every step stays open under <strong>Settings › Setup</strong>.
      </p>
    </div>
  );
}
