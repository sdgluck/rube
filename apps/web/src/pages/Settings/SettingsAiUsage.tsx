/**
 * Settings → AI → Usage: what the configured provider has been asked to do,
 * and the monthly cap on it.
 *
 * Tokens, not money — see the header of `@rube/domain.ai-usage` for why
 * there is no cost estimate. The budget saves on its own button rather than
 * riding the provider form's: switching provider and capping spend are
 * unrelated edits, and one dirty flag over both would make "Save" ambiguous.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { formatNumber } from "#/format";
import { useToast } from "#components/Toast";
import CardSection from "#components/CardSection";
import ErrorState from "#components/ErrorState";
import { FormSkeleton } from "#components/Skeleton";
import settings from "./Settings.module.css";
import styles from "./SettingsAiUsage.module.css";

const FEATURE_LABELS: Record<string, string> = {
  rule: "AI rules",
  "rule-preview": "Rule previews",
  "rule-draft": "Rule drafts",
  "because-you-watched": "Because you watched",
  "because-you-watched-preview": "Because you watched (Try it)",
  "we-think-youd-like": "We think you'd like",
  "season-collections": "Season collections",
  "collection-summary": "Collection summaries",
  "health-check": "Health checks",
  "test-connection": "Test connection",
};

interface Totals {
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

function Window({ label, totals }: { label: string; totals: Totals }) {
  return (
    <div className={styles.window}>
      <div className={styles.windowLabel}>{label}</div>
      <div className={styles.windowValue}>{formatNumber(totals.tokensIn + totals.tokensOut)} tokens</div>
      <div className={styles.windowMeta}>
        {formatNumber(totals.calls)} call{totals.calls === 1 ? "" : "s"}
        {totals.failed > 0 && ` · ${formatNumber(totals.failed)} failed`}
      </div>
    </div>
  );
}

function TokenCells({ row }: { row: Totals }) {
  return (
    <>
      <td className={styles.num}>{formatNumber(row.calls)}</td>
      <td className={styles.num}>{formatNumber(row.tokensIn)}</td>
      <td className={styles.num}>{formatNumber(row.tokensOut)}</td>
    </>
  );
}

function TokenHeads() {
  return (
    <>
      <th className={styles.num}>Calls</th>
      <th className={styles.num}>In</th>
      <th className={styles.num}>Out</th>
    </>
  );
}

export default function SettingsAiUsage() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const usageQuery = trpc.aiUsage.summary.useQuery(undefined, { refetchOnWindowFocus: false });
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfigMutation = trpc.config.save.useMutation();

  const savedBudget = configQuery.data?.ai_monthly_token_budget ?? 0;
  const [budgetInput, setBudgetInput] = useState("");
  useEffect(() => {
    setBudgetInput(savedBudget > 0 ? String(savedBudget) : "");
  }, [savedBudget]);

  const parsedBudget = budgetInput.trim() === "" ? 0 : Number(budgetInput);
  const budgetValid = Number.isInteger(parsedBudget) && parsedBudget >= 0;
  const budgetDirty = budgetValid && parsedBudget !== savedBudget;

  async function saveBudget() {
    try {
      await saveConfigMutation.mutateAsync({ ai_monthly_token_budget: parsedBudget });
      addToast(parsedBudget > 0 ? "Monthly budget saved" : "Monthly budget removed", "success");
      await Promise.all([configQuery.refetch(), utils.aiUsage.summary.invalidate()]);
    } catch {
      addToast("Failed to save the monthly budget", "error");
    }
  }

  if (usageQuery.isLoading) return <FormSkeleton rows={3} />;
  if (usageQuery.error || !usageQuery.data) {
    return (
      <ErrorState inline title="Couldn't load AI usage" error={usageQuery.error} onRetry={() => usageQuery.refetch()} />
    );
  }
  const { day, week, month, budget, byFeature, byModel, byRule } = usageQuery.data;
  const pct = budget.budget ? Math.min(100, Math.round((budget.used / budget.budget) * 100)) : 0;

  return (
    <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Usage">
      <div className={styles.windows}>
        <Window label="Last 24 hours" totals={day} />
        <Window label="Last 7 days" totals={week} />
        <Window label="Last 30 days" totals={month} />
      </div>

      <div className={settings.field}>
        <span className={settings.label}>Monthly token budget</span>
        <div className={settings.suffixRow}>
          <input
            type="number"
            min={0}
            step={1000}
            inputMode="numeric"
            className={settings.input}
            placeholder="No limit"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
          />
          <span className={settings.suffix}>tokens (in + out) per calendar month</span>
        </div>
        {budget.budget !== null ? (
          <>
            <div
              className={styles.budgetMeter}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={budget.budget}
              aria-valuenow={budget.used}
              aria-label="Budget used this month"
            >
              <div
                className={budget.exceeded ? styles.budgetFillOver : styles.budgetFill}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={settings.hint}>
              {formatNumber(budget.used)} of {formatNumber(budget.budget)} used since{" "}
              {new Date(budget.monthStart).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.
              {budget.exceeded &&
                " Spent — AI rules, Because you watched, We think you'd like and AI summaries are skipped until the 1st. Health checks and Test connection still run."}
            </span>
          </>
        ) : (
          <span className={settings.hint}>
            {formatNumber(budget.used)} used this month. Once a budget is reached, AI work is skipped until the month
            rolls over.
          </span>
        )}
        <div className={settings.buttons}>
          <button
            type="button"
            className={settings.button}
            onClick={saveBudget}
            disabled={!budgetDirty || saveConfigMutation.isPending}
          >
            {saveConfigMutation.isPending ? "Saving…" : "Save budget"}
          </button>
        </div>
      </div>

      {month.calls === 0 ? (
        <p className={settings.hint}>No AI requests in the last 30 days.</p>
      ) : (
        <>
          <table className={styles.usageTable}>
            <caption className={settings.hint}>Last 30 days, by feature</caption>
            <thead>
              <tr>
                <th>Feature</th>
                <TokenHeads />
              </tr>
            </thead>
            <tbody>
              {byFeature.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{FEATURE_LABELS[row.feature] ?? row.feature}</th>
                  <TokenCells row={row} />
                </tr>
              ))}
            </tbody>
          </table>

          <table className={styles.usageTable}>
            <caption className={settings.hint}>By model</caption>
            <thead>
              <tr>
                <th>Model</th>
                <TokenHeads />
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => (
                <tr key={`${row.provider}:${row.model}`}>
                  <th scope="row">
                    {row.model} <span className={styles.muted}>{row.provider}</span>
                  </th>
                  <TokenCells row={row} />
                </tr>
              ))}
            </tbody>
          </table>

          {byRule.length > 0 && (
            <table className={styles.usageTable}>
              <caption className={settings.hint}>Top rules</caption>
              <thead>
                <tr>
                  <th>Rule</th>
                  <TokenHeads />
                </tr>
              </thead>
              <tbody>
                {byRule.map((row) => (
                  <tr key={row.ruleId}>
                    <th scope="row">
                      {row.ruleName ? (
                        <Link to={`/rules/${row.ruleId}/runs`}>{row.ruleName}</Link>
                      ) : (
                        <span className={styles.muted}>Deleted rule</span>
                      )}
                    </th>
                    <TokenCells row={row} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </CardSection>
  );
}
