import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import { IMDB_CHARTS } from "#pages/Rules/RuleWizard/constants.ts";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";

export default function ImdbChartSource({ form, setForm }: SourceStepProps) {
  return (
    <>
      <h3 className={styles.stepHeading}>Pick a chart</h3>
      <p className={styles.stepSub}>The chart's media type also determines which sections are included.</p>
      <div className={styles.typeGrid}>
        {IMDB_CHARTS.map((c) => {
          const selected = form.chart === c.value;
          return (
            <button
              key={c.value}
              type="button"
              className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ""}`}
              onClick={() => setForm({ ...form, chart: c.value })}
              aria-pressed={selected}
            >
              <span className={styles.typeCardName}>{c.label}</span>
              <span className={styles.typeCardDesc}>
                Targets {c.sectionType === "movie" ? "Movie" : "TV"} sections.
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
