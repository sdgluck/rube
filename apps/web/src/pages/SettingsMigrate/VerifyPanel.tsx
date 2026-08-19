import { useRef, useState } from "react";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import Spinner from "#components/Spinner";
import styles from "#pages/Settings/Settings.module.css";
import local from "./SettingsMigrate.module.css";

interface Verdict {
  ruleName: string;
  comparable: boolean;
  kometa: number;
  tinkerbell: number;
  common: number;
  onlyInTinkerbell?: string[];
}

/** Below this share in common, a rule is worth opening rather than trusting. */
const GOOD = 0.9;
const POOR = 0.6;

/**
 * "Did the migration actually reproduce my collections?"
 *
 * This is the screen that makes turning Kometa off a decision rather than a
 * leap. Each migrated rule is dry-run — nothing is written to Plex — and its
 * would-be contents compared against the Kometa collection it replaced. A user
 * with 118 migrated rules doesn't have to check 118 collections by hand; they
 * have to look at the six that came back amber.
 *
 * Rules are verified one at a time on purpose. Each dry run indexes a library,
 * so firing all of them at once would hammer Plex and give no feedback until
 * the end; sequential means the list fills in visibly and can be stopped.
 */
export default function VerifyPanel() {
  const targetsQuery = trpc.migration.verifyTargets.useQuery(undefined, { refetchOnWindowFocus: false });
  const verifyMutation = trpc.migration.verifyRule.useMutation();

  const [verdicts, setVerdicts] = useState<Record<string, Verdict | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // A ref, not state: the loop below reads this *between* rules, and a state
  // value captured when `runAll` was created never changes for that closure —
  // the Stop button would render but do nothing.
  const cancelled = useRef(false);

  const targets = targetsQuery.data;
  if (!targets || targets.entries.length === 0) return null;

  const checkable = targets.entries.filter((e) => e.checkable);
  if (checkable.length === 0) return null;

  const runAll = async () => {
    cancelled.current = false;
    for (const entry of checkable) {
      if (cancelled.current) break;
      setBusy(entry.ruleId);
      try {
        const result = await verifyMutation.mutateAsync({ ruleId: entry.ruleId });
        setVerdicts((prev) => ({ ...prev, [entry.ruleId]: result }));
      } catch (err) {
        setVerdicts((prev) => ({ ...prev, [entry.ruleId]: { error: (err as Error).message ?? "Failed" } }));
      }
    }
    setBusy(null);
  };

  const done = checkable.filter((e) => verdicts[e.ruleId]).length;

  return (
    <CardSection
      className={styles.group}
      titleClassName={styles.groupTitle}
      title={<>Check the migration ({checkable.length})</>}
    >
      <p className={styles.hint}>
        Dry-runs each migrated rule and compares what it would build against the Kometa collection it replaced. Nothing
        is written to Plex.
      </p>

      <div className={styles.buttons}>
        <button type="button" className={styles.buttonSecondary} onClick={() => void runAll()} disabled={busy !== null}>
          {busy ? (
            <>
              <Spinner size="xs" /> Checking {done + 1} of {checkable.length}…
            </>
          ) : done > 0 ? (
            "Check again"
          ) : (
            `Check ${checkable.length} rule(s)`
          )}
        </button>
        {busy && (
          <button type="button" className={styles.buttonSecondary} onClick={() => (cancelled.current = true)}>
            Stop
          </button>
        )}
      </div>

      {done > 0 && (
        <div className="table-scroll in-panel">
          <table className={local.planTable}>
            <thead>
              <tr>
                <th>Rule</th>
                <th className={local.numCol}>Kometa</th>
                <th className={local.numCol}>Tinkerbell</th>
                <th className={local.numCol}>In common</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {checkable.map((entry) => {
                const v = verdicts[entry.ruleId];
                if (!v) return null;
                if ("error" in v) {
                  return (
                    <tr key={entry.ruleId}>
                      <td data-cell="title">{entry.ruleName}</td>
                      <td colSpan={4} className={local.errorHint}>
                        {v.error}
                      </td>
                    </tr>
                  );
                }
                const share = v.kometa > 0 ? v.common / v.kometa : 0;
                const status = share >= GOOD ? "ok" : share >= POOR ? "warn" : "bad";
                return (
                  <tr key={entry.ruleId}>
                    <td data-cell="title">
                      {v.ruleName}
                      {v.onlyInTinkerbell && v.onlyInTinkerbell.length > 0 && (
                        <div className={local.rowHint}>
                          new: {v.onlyInTinkerbell.slice(0, 3).join(", ")}
                          {v.onlyInTinkerbell.length > 3 ? ", …" : ""}
                        </div>
                      )}
                    </td>
                    <td data-cell="meta" className={local.numCol}>
                      {v.kometa}
                    </td>
                    <td data-cell="meta" className={local.numCol}>
                      {v.tinkerbell}
                    </td>
                    <td data-cell="meta" className={local.numCol}>
                      {v.common}
                    </td>
                    <td data-cell="meta">
                      <span className={local.verdictChip} data-status={status}>
                        {Math.round(share * 100)}%
                      </span>
                      {status !== "ok" && <div className={local.rowHint}>Worth a look before you rely on it.</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CardSection>
  );
}
