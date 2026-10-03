import { useState } from "react";
import { trpc } from "#/trpc";
import Spinner from "#components/Spinner";
import styles from "./MediaDetail.module.css";

/**
 * Ask a rule why it does — or doesn't — include this item.
 *
 * The page could already say which rules put an item where it is. The far
 * more common question is the inverse, and nothing could answer it: the
 * filter funnel measures a whole library, and `rules.test` takes a rule id
 * and nothing else. "Why isn't this in Hidden Gems" ended in reading the
 * filter and guessing.
 *
 * A picker rather than a report on every rule: evaluating one item against
 * forty rules is forty round trips to Plex to answer a question about one of
 * them, and the person asking already knows which one they mean.
 */
export default function MediaWhyPanel({ ratingKey }: { ratingKey: string }) {
  const [ruleId, setRuleId] = useState("");

  const rulesQuery = trpc.rules.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const explainQuery = trpc.rules.explainItem.useQuery(
    { ruleId, ratingKey },
    { enabled: ruleId !== "", refetchOnWindowFocus: false },
  );

  const rules = rulesQuery.data ?? [];
  if (rules.length === 0) return null;

  const result = explainQuery.data;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Why this item?</h3>

      <select
        className={styles.whySelect}
        value={ruleId}
        onChange={(e) => setRuleId(e.target.value)}
        aria-label="Check this item against a rule"
      >
        <option value="">Check against a rule…</option>
        {rules.map((rule) => (
          <option key={rule.id} value={rule.id}>
            {rule.name}
          </option>
        ))}
      </select>

      {explainQuery.isFetching && <Spinner size="xs" />}

      {explainQuery.error && <p className={styles.whyReason}>{explainQuery.error.message}</p>}

      {result && !explainQuery.isFetching && (
        <>
          <p className={styles.whyVerdict}>
            <span className={result.matches ? styles.whyMatch : styles.whyNoMatch}>
              {result.matches ? "Match" : "No match"}
            </span>
          </p>
          {result.reason && <p className={styles.whyReason}>{result.reason}</p>}
          {result.clauses.length > 0 && (
            <>
              <p className={styles.whyCombinator}>{result.combinator === "any" ? "ANY of" : "ALL of"}</p>
              <ul className={styles.whyClauses}>
                {result.clauses.map((clause, i) => (
                  <li key={i} className={clause.passed ? styles.whyPass : styles.whyFail}>
                    {/* A symbol as well as the colour: the whole point is to
                        pick one failing row out of six, and colour alone does
                        not do that for everyone. */}
                    <span aria-hidden="true">{clause.passed ? "✓" : "✗"}</span>
                    <span className="sr-only">{clause.passed ? "Passes" : "Fails"}:</span> {clause.label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
