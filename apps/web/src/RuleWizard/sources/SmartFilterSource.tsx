import shared from "../../pages/Collections.module.css";
import styles from "../RuleWizard.module.css";
import { SMART_FILTER_FIELDS, SMART_FILTER_OPS } from "../constants.ts";
import type { SmartFilterClause, SmartFilterOp, SourceStepProps } from "../types.ts";

export default function SmartFilterSource({ form, setForm }: SourceStepProps) {
  const updateClause = (i: number, patch: Partial<SmartFilterClause>) => {
    const next = form.filters.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    setForm({ ...form, filters: next });
  };
  const removeClause = (i: number) => {
    setForm({ ...form, filters: form.filters.filter((_, idx) => idx !== i) });
  };
  const addClause = () => {
    setForm({
      ...form,
      filters: [...form.filters, { field: "genre", op: "=", value: "" }],
    });
  };

  return (
    <>
      <h3 className={styles.stepHeading}>Smart filter</h3>
      <p className={styles.stepSub}>
        Build the criteria the rule will use to query Plex. Clauses are AND'd together; one collection per section is
        created from the matching items each time the rule runs.
      </p>
      <div className={styles.field}>
        <label htmlFor="rule-smart-filter-name">Collection name (optional)</label>
        <input
          id="rule-smart-filter-name"
          className={shared.input}
          value={form.collectionName}
          onChange={(e) => setForm({ ...form, collectionName: e.target.value })}
          placeholder="Smart Filter"
        />
      </div>
      <div className={styles.field}>
        <label>Filters</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {form.filters.map((clause, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className={shared.input}
                style={{ flex: "0 0 140px" }}
                value={clause.field}
                onChange={(e) => updateClause(i, { field: e.target.value })}
                aria-label="Field"
              >
                {SMART_FILTER_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                className={shared.input}
                style={{ flex: "0 0 80px" }}
                value={clause.op}
                onChange={(e) => updateClause(i, { op: e.target.value as SmartFilterOp })}
                aria-label="Operator"
              >
                {SMART_FILTER_OPS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                className={shared.input}
                style={{ flex: 1 }}
                value={clause.value}
                onChange={(e) => updateClause(i, { value: e.target.value })}
                placeholder="Value"
                aria-label="Value"
              />
              <button
                type="button"
                className={styles.summaryEdit}
                onClick={() => removeClause(i)}
                aria-label={`Remove clause ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className={styles.summaryEdit} onClick={addClause} style={{ alignSelf: "flex-start" }}>
            + Add clause
          </button>
        </div>
      </div>
    </>
  );
}
