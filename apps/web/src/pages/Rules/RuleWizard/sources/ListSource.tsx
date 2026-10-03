import shared from "#/styles/shared.module.css";
import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import { LIST_ID_PLACEHOLDERS, LIST_PROVIDERS } from "#pages/Rules/RuleWizard/constants.ts";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";

export default function ListSource({ form, setForm }: SourceStepProps) {
  return (
    <>
      <h3 className={styles.stepHeading}>List source</h3>
      <div className={styles.field}>
        <label>Provider</label>
        <div className={styles.pills}>
          {LIST_PROVIDERS.map((p) => {
            const selected = form.listProvider === p.value;
            return (
              <button
                key={p.value}
                type="button"
                className={`${styles.pill} ${selected ? styles.pillSelected : ""}`}
                onClick={() => !p.disabled && setForm({ ...form, listProvider: p.value })}
                disabled={p.disabled}
                aria-pressed={selected}
                title={p.disabled ? "Coming soon" : undefined}
              >
                {p.label}
                {p.disabled ? " (soon)" : ""}
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor="rule-list-source-id">List ID</label>
        <input
          id="rule-list-source-id"
          className={shared.input}
          value={form.listId}
          onChange={(e) => setForm({ ...form, listId: e.target.value })}
          placeholder={LIST_ID_PLACEHOLDERS[form.listProvider] ?? "List identifier"}
          autoFocus
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="rule-list-collection-name">Collection name (optional)</label>
        <input
          id="rule-list-collection-name"
          className={shared.input}
          value={form.collectionName}
          onChange={(e) => setForm({ ...form, collectionName: e.target.value })}
          placeholder="Defaults to the list's name"
        />
      </div>
    </>
  );
}
