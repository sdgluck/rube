import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import EmptyState from "#components/EmptyState";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";

/**
 * The step that earns the trust the rest of the flow spent.
 *
 * A dry run builds nothing and touches nothing — it reports what a real run
 * *would* create. Putting it before the enable switch is the whole point:
 * nobody should have to find out what a rule does by letting it loose on their
 * library.
 */

interface RuleSummary {
  id: string;
  name: string;
  enabled: number;
  lastTestAt: number | null;
  lastTestStatus: string | null;
  lastTestCollectionCount: number | null;
  lastTestItemCount: number | null;
  lastTestError: string | null;
}

/**
 * The outcome of a rule's last dry run, from the denormalised `lastTest*`
 * columns `rules.list` already returns.
 *
 * Not `rules.lastTestResult`: that is an in-memory preview which a *failed*
 * test never writes at all, so waiting on it leaves a row that failed spinning
 * forever. These columns are written on both paths and carry the counts this
 * step displays, at no extra request.
 */
function LastTestResult({ rule, running }: { rule: RuleSummary; running: boolean }) {
  if (running || rule.lastTestAt == null) return null;

  if (rule.lastTestStatus === "error") {
    return <p className={styles.ruleError}>Dry run failed: {rule.lastTestError ?? "unknown error"}</p>;
  }
  if (rule.lastTestStatus === "cancelled") {
    return <p className={styles.ruleResult}>That dry run was cancelled.</p>;
  }

  const collections = rule.lastTestCollectionCount ?? 0;
  const items = rule.lastTestItemCount ?? 0;
  return (
    <p className={styles.ruleResult}>
      Would build <strong>{collections}</strong> collection{collections === 1 ? "" : "s"} holding{" "}
      <strong>{items}</strong> item{items === 1 ? "" : "s"}. Nothing was created.
    </p>
  );
}

function RuleRow({ rule, running }: { rule: RuleSummary; running: boolean }) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const test = trpc.rules.test.useMutation();
  const [starting, setStarting] = useState(false);

  // `activeRuns` polls every couple of seconds, so between pressing the button
  // and the next poll the row would look idle. This covers that gap only.
  const busy = running || starting;
  useEffect(() => {
    if (running) setStarting(false);
  }, [running]);

  async function runTest() {
    setStarting(true);
    try {
      await test.mutateAsync({ id: rule.id });
      utils.rules.activeRuns.invalidate();
    } catch (err) {
      setStarting(false);
      addToast(`Couldn't dry-run "${rule.name}": ${(err as Error).message}`, "error");
    }
  }

  return (
    <li className={styles.ruleRow}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleName}>{rule.name}</span>
        <span className={styles.ruleState}>{rule.enabled ? "Enabled" : "Disabled"}</span>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
          onClick={runTest}
          disabled={busy}
        >
          {busy ? "Running…" : "Dry run"}
        </button>
      </div>
      <LastTestResult rule={rule} running={busy} />
    </li>
  );
}

export default function DryRunStep() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const rulesQuery = trpc.rules.list.useQuery();
  const updateRule = trpc.rules.update.useMutation();
  const [enabling, setEnabling] = useState(false);

  // The same 2s poll the Rules page uses. It is the authority on "is this rule
  // running", for a run started from any tab or by the scheduler.
  const activeRunsQuery = trpc.rules.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const activeIds = new Set((activeRunsQuery.data ?? []).map((r) => r.ruleId));

  // A rule leaving the active set means its run row is final — that is when
  // the outcome below it, and the step's own completion, become readable.
  const previouslyActive = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const id of previouslyActive.current) {
      if (activeIds.has(id)) continue;
      utils.rules.list.invalidate();
      utils.onboarding.status.invalidate();
    }
    previouslyActive.current = activeIds;
    // `activeIds` is a fresh Set each render; the query data behind it is the
    // real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [activeRunsQuery.data, utils]);

  const rules = rulesQuery.data ?? [];
  const disabled = rules.filter((r) => !r.enabled);

  async function enableAll() {
    setEnabling(true);
    try {
      for (const rule of disabled) {
        await updateRule.mutateAsync({ id: rule.id, enabled: true });
      }
      await utils.rules.list.invalidate();
      addToast(`Enabled ${disabled.length} rule${disabled.length === 1 ? "" : "s"}`, "success");
    } catch (err) {
      addToast(`Couldn't enable rules: ${(err as Error).message}`, "error");
    } finally {
      setEnabling(false);
    }
  }

  if (rules.length === 0) {
    return (
      <div className={styles.stepBody}>
        <h2 className={styles.stepTitle}>Try a rule before you trust it</h2>
        <EmptyState
          icon="cog"
          title="No rules to try yet"
          description="Go back a step to import a pack or build one, or skip this — you can dry-run any rule from the Rules page whenever you like."
          action={
            <Link to="/rules" className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}>
              Open Rules
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Try a rule before you trust it</h2>
      <p className={styles.stepLede}>
        A dry run reports what a rule <em>would</em> build without creating anything in Plex. Worth doing on at least
        one before you switch them on — and if a real run ever surprises you, it can be reverted.
      </p>

      <ul className={styles.ruleList}>
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} running={activeIds.has(rule.id)} />
        ))}
      </ul>

      {disabled.length > 0 && (
        <div className={styles.recommend}>
          <h3 className={styles.groupHeading}>Ready to go live?</h3>
          <p className={styles.fieldHint}>
            {disabled.length} rule{disabled.length === 1 ? " is" : "s are"} still disabled. Enabling means they run on
            the schedule you set and start creating collections for real.
          </p>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
            onClick={enableAll}
            disabled={enabling}
          >
            {enabling ? "Enabling…" : `Enable ${disabled.length} rule${disabled.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
