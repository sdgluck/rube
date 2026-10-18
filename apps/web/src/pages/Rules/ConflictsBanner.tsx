import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import { groupConflicts, type ConflictGroup } from "./conflictGroups.ts";
import styles from "./Rules.module.css";

/**
 * Where two rules disagree.
 *
 * Nothing in the engine arbitrates between rules, so all three kinds of
 * disagreement are silent: both rules report a successful run and the result
 * is decided by whichever went first. This is the only place that says so.
 *
 * Grouped by the rules involved, and every rule name opens that rule: the
 * banner used to print one identical sentence per colliding collection name —
 * 25 of them for two streaming rules — and never said which rules they were,
 * which is the one thing needed to fix it.
 *
 * Collapsed to the first group by default, so a server with a real conflict
 * doesn't push the rules table off the screen.
 */
export default function ConflictsBanner({ onOpenRule }: { onOpenRule: (ruleId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const query = trpc.rules.conflicts.useQuery(undefined, { refetchOnWindowFocus: false });

  const conflicts = query.data ?? [];
  if (conflicts.length === 0) return null;

  const groups = groupConflicts(conflicts);
  const shown = expanded ? groups : groups.slice(0, 1);

  return (
    <Banner
      variant="warn"
      actions={
        groups.length > 1 ? (
          <button type="button" className={styles.conflictToggle} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${groups.length}`}
          </button>
        ) : undefined
      }
    >
      <strong>
        {conflicts.length} rule conflict{conflicts.length === 1 ? "" : "s"}
        {groups.length < conflicts.length && ` between ${groups.length} set${groups.length === 1 ? "" : "s"} of rules`}
      </strong>
      <ul className={styles.conflictList}>
        {shown.map((group) => (
          <li key={group.key} className={styles.conflictGroup}>
            <GroupSummary group={group} onOpenRule={onOpenRule} />
          </li>
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

function GroupSummary({ group, onOpenRule }: { group: ConflictGroup; onOpenRule: (ruleId: string) => void }) {
  const ruleNames = <RuleNames rules={group.rules} onOpenRule={onOpenRule} />;

  if (group.kind !== "collection-name") {
    return (
      <>
        {group.details[0]} <span className={styles.conflictRules}>— {ruleNames}</span>
      </>
    );
  }

  const count = group.subjects.length;
  const where = group.library ? ` in ${group.library.title}` : "";
  return (
    <>
      {ruleNames} {group.rules.length === 2 ? "both build" : "all build"}{" "}
      {count === 1 ? "a collection with the same name" : `${count} collections with the same names`}
      {where}. Each keeps its own items, but each name below appears{" "}
      {group.rules.length === 2 ? "twice" : "more than once"} and people can't tell the copies apart.
      <span className={styles.conflictNames}>
        {group.subjects.map((name) => (
          <Link
            key={name}
            className={styles.conflictName}
            to={collectionsLink(name, group.library?.key)}
            title={`See every "${name}" collection`}
          >
            {name}
          </Link>
        ))}
      </span>
    </>
  );
}

/** "A", "A and B", "A, B and C" — each one opening its rule. */
function RuleNames({ rules, onOpenRule }: { rules: ConflictGroup["rules"]; onOpenRule: (ruleId: string) => void }) {
  return (
    <>
      {rules.map((rule, i) => (
        <Fragment key={rule.id}>
          {i > 0 && (i === rules.length - 1 ? " and " : ", ")}
          <button
            type="button"
            className={styles.conflictRule}
            onClick={() => onOpenRule(rule.id)}
            title="Open this rule"
          >
            {rule.name}
          </button>
        </Fragment>
      ))}
    </>
  );
}

/** The Collections page, searched to one name and narrowed to its library. */
function collectionsLink(name: string, sectionKey?: string): string {
  const params = new URLSearchParams({ q: name });
  if (sectionKey) params.set("section", sectionKey);
  return `/collections?${params}`;
}
