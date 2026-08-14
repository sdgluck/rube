import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import { SEERR_FILTERS } from "#pages/Rules/RuleWizard/constants.ts";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";

export default function SeerrRequestsSource({ form, setForm, config }: SourceStepProps) {
  const seerrConfigured = !!config?.seerrConfigured;
  return (
    <>
      <h3 className={styles.stepHeading}>Which requests?</h3>
      <p className={styles.stepSub}>Filter the request set used to build this collection.</p>
      <div className={styles.field}>
        <label>Filter</label>
        <div className={styles.pills}>
          {SEERR_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`${styles.pill} ${form.filter === f.value ? styles.pillSelected : ""}`}
              onClick={() => setForm({ ...form, filter: f.value })}
              aria-pressed={form.filter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {!seerrConfigured && (
        <p className={styles.hint}>Heads-up: Seerr is not configured in Settings → Media Managers.</p>
      )}
    </>
  );
}
