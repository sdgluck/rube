import { useState } from "react";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import styles from "./Rules.module.css";

/**
 * Where two rules disagree.
 *
 * Nothing in the engine arbitrates between rules, so all three kinds of
 * disagreement are silent: both rules report a successful run and the result
 * is decided by whichever went first. This is the only place that says so.
 *
 * Collapsed to a count by default. A server with a real conflict usually has
 * a handful at once — one duplicated collection name produces one row, but a
 * cleanup rule overlapping a busy collection can produce dozens — and a
 * banner that pushed the rules table off the screen would be closed and never
 * opened again.
 */
export default function ConflictsBanner() {
  const [expanded, setExpanded] = useState(false);
  const query = trpc.rules.conflicts.useQuery(undefined, { refetchOnWindowFocus: false });

  const conflicts = query.data ?? [];
  if (conflicts.length === 0) return null;

  const shown = expanded ? conflicts : conflicts.slice(0, 1);

  return (
    <Banner
      variant="warn"
      actions={
        conflicts.length > 1 ? (
          <button type="button" className={styles.conflictToggle} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${conflicts.length}`}
          </button>
        ) : undefined
      }
    >
      <strong>
        {conflicts.length} rule conflict{conflicts.length === 1 ? "" : "s"}
      </strong>
      <ul className={styles.conflictList}>
        {shown.map((c, i) => (
          <li key={`${c.kind}-${c.subject}-${i}`}>{c.detail}</li>
        ))}
      </ul>
      {/* Deliberately not offered as a fix-it button: which rule should win is
          a decision about what the library is for, and picking one silently
          would just be an invisible precedence rule again. */}
      <span className={styles.conflictHint}>
        Rules run top to bottom — drag one to change which wins, or narrow the rule that shouldn&rsquo;t have matched.
      </span>
    </Banner>
  );
}
