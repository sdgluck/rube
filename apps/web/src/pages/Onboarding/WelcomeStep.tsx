import styles from "./Onboarding.module.css";

/**
 * The concepts tour.
 *
 * Deliberately first, and deliberately free of inputs: the next step asks for
 * a token that can rewrite someone's whole library, and it's fairer to explain
 * what the thing does — and what it won't do without being told — before
 * asking for that than after.
 */
const CONCEPTS = [
  {
    title: "Rules build collections",
    body: "A rule is a question about your library — “films from the 90s I haven't watched”, “everything Scorsese directed” — and Tinkerbell keeps a Plex collection in step with the answer. Write your own, or import one from the registry.",
  },
  {
    title: "Jobs run them on a schedule",
    body: "Rules don't run when you save them. A scheduled job sweeps them, so collections stay current as your library grows. You choose the timing, and Tinkerbell can hold off while someone is watching.",
  },
  {
    title: "Nothing happens until you enable it",
    body: "Rules are created disabled. You can dry-run any rule to see exactly what it would build before it builds anything, and every run can be reverted afterwards.",
  },
  {
    title: "Cleanup is separate, and off",
    body: "Tinkerbell can also delete watched or stale media, but that lives behind its own master switch that ships off. Nothing in this setup turns it on.",
  },
];

export default function WelcomeStep() {
  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Welcome to Tinkerbell</h2>
      <p className={styles.stepLede}>
        Four things worth knowing before you start. This takes a minute, and you can leave at any point — your progress
        is saved as you go.
      </p>
      <div className={styles.conceptGrid}>
        {CONCEPTS.map((concept) => (
          <div key={concept.title} className={styles.concept}>
            <h3 className={styles.conceptTitle}>{concept.title}</h3>
            <p className={styles.conceptBody}>{concept.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
