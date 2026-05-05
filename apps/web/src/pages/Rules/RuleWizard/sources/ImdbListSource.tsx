import shared from "#pages/Collections.module.css";
import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";

export default function ImdbListSource({ form, setForm }: SourceStepProps) {
  return (
    <>
      <h3 className={styles.stepHeading}>IMDb list</h3>
      <p className={styles.stepSub}>Paste a public IMDb list URL or list ID.</p>
      <div className={styles.field}>
        <label htmlFor="rule-list-id">List URL or ID</label>
        <input
          id="rule-list-id"
          className={shared.input}
          value={form.listId}
          onChange={(e) => setForm({ ...form, listId: e.target.value })}
          placeholder="ls123456789 or https://www.imdb.com/list/ls123456789/"
          autoFocus
        />
      </div>
    </>
  );
}
