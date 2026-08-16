import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PreviewHubRow } from "#components/PreviewHubRow";
import { trpc } from "#/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tinkerbell/trpc";
import InlineProgress from "./InlineProgress";
import styles from "./Rules.module.css";
import { formatDuration } from "#/format";

interface RuleDetailRowProps {
  ruleId: string;
  /** The in-flight run to show the log of, when there is one. */
  runId: string | null;
  isTesting: boolean;
  isRunning: boolean;
  errorToShow: string | null;
  onCleared: () => void;
}

export default function RuleDetailRow({
  ruleId,
  runId,
  isTesting,
  isRunning,
  errorToShow,
  onCleared,
}: RuleDetailRowProps) {
  const resultQuery = trpc.rules.lastTestResult.useQuery({ id: ruleId }, { enabled: !isRunning });
  const hasResult = !!resultQuery.data;
  const showAnything = isTesting || isRunning || !!errorToShow || hasResult;
  const [tdEl, setTdEl] = useState<HTMLTableCellElement | null>(null);
  const [wrapperWidth, setWrapperWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!tdEl) return;
    const wrapper = tdEl.closest<HTMLElement>(".table-scroll");
    if (!wrapper) return;
    const update = () => setWrapperWidth(wrapper.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [tdEl]);

  if (!showAnything) return null;

  return (
    <tr className={styles.detailRow}>
      <td ref={setTdEl} colSpan={9}>
        <div className={styles.detailWrap}>
          {(isTesting || isRunning) && runId && <InlineProgress runId={runId} phase={isTesting ? "test" : "run"} />}
          {!isTesting && !isRunning && errorToShow && (
            <div style={{ marginBottom: 12 }}>
              <div className={styles.detailHeader}>
                <span className={styles.detailTitle}>Last error</span>
              </div>
              <div className={styles.errorBox}>{errorToShow}</div>
            </div>
          )}
          {!isRunning && !isTesting && (
            <TestResultsBlock ruleId={ruleId} onCleared={onCleared} wrapperWidth={wrapperWidth} />
          )}
        </div>
      </td>
    </tr>
  );
}

type RouterOutputs = inferRouterOutputs<AppRouter>;
type FunnelSection = NonNullable<NonNullable<RouterOutputs["rules"]["lastTestResult"]>["funnel"]>[number];

/**
 * Where the items went, clause by clause.
 *
 * The number this exists for is zero. "0 items" with six clauses in the rule
 * makes all six equally suspect; the clause whose row drops to nothing is the
 * answer, and it's usually obvious the moment you can see the sequence.
 *
 * The bar is proportional to the library, not to the previous step, so a clause
 * that halves the set looks like half — a bar rescaled at each step makes every
 * clause look equally decisive.
 */
function FilterFunnel({ sections }: { sections: FunnelSection[] }) {
  return (
    <div className={styles.funnel}>
      {sections.map((section) => (
        <div key={section.sectionTitle} className={styles.funnelSection}>
          <div className={styles.funnelHead}>
            <strong>{section.sectionTitle}</strong>
            <span className={styles.funnelHeadMeta}>
              {section.mode === "contributing"
                ? "any of these clauses — each measured against the whole library"
                : `${section.start.toLocaleString()} → ${section.final.toLocaleString()}`}
            </span>
          </div>
          <ol className={styles.funnelSteps}>
            <li className={styles.funnelStep}>
              <span className={styles.funnelLabel}>Everything in the library</span>
              <FunnelBar value={section.start} of={section.start} />
              <span className={styles.funnelCount}>{section.start.toLocaleString()}</span>
            </li>
            {section.steps.map((step, i) => (
              <li key={i} className={styles.funnelStep}>
                <span className={styles.funnelLabel}>
                  {step.label}
                  {/* Watch-state clauses are applied here, not by Plex — worth
                      saying, because they're the ones that behave differently. */}
                  {step.source === "local" && <span className={styles.funnelLocalTag}>watch history</span>}
                </span>
                <FunnelBar value={step.remaining} of={section.start} />
                <span className={styles.funnelCount}>
                  {step.remaining.toLocaleString()}
                  {step.removed > 0 && <span className={styles.funnelRemoved}>−{step.removed.toLocaleString()}</span>}
                </span>
              </li>
            ))}
          </ol>
          {section.final === 0 && section.steps.length > 0 && (
            <p className={styles.funnelVerdict}>
              {(() => {
                const culprit = section.steps.find((s) => s.remaining === 0);
                return culprit
                  ? `Nothing survives "${culprit.label}". Loosen that clause first.`
                  : "Nothing matched, though no single clause emptied it — the combination is too narrow.";
              })()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function FunnelBar({ value, of }: { value: number; of: number }) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <span className={styles.funnelTrack} aria-hidden="true">
      {/* A surviving-but-tiny result still gets a sliver, so "a few" and
          "none" don't render identically. */}
      <span className={styles.funnelFill} style={{ width: `${value > 0 ? Math.max(pct, 1) : 0}%` }} />
    </span>
  );
}

interface TestResultsBlockProps {
  ruleId: string;
  onCleared?: () => void;
  wrapperWidth: number | null;
}

function TestResultsBlock({ ruleId, onCleared, wrapperWidth }: TestResultsBlockProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const resultQuery = trpc.rules.lastTestResult.useQuery({ id: ruleId });
  const clearMutation = trpc.rules.clearTestResult.useMutation({
    onSuccess: () => {
      utils.rules.lastTestResult.invalidate({ id: ruleId });
      utils.rules.list.invalidate();
      onCleared?.();
    },
  });
  const result = resultQuery.data;
  if (!result) return null;
  const totalItems = result.collections.reduce((sum, c) => sum + c.items.length, 0);

  // Match the .detailWrap inner content area: 18px horizontal padding on each side.
  const stackWidth = wrapperWidth != null ? wrapperWidth - 36 : null;

  return (
    <div>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>Test results</span>
        <button
          type="button"
          className={styles.testPreviewCloseBtn}
          onClick={() => clearMutation.mutate({ id: ruleId })}
        >
          Clear
        </button>
      </div>
      <div className={styles.detailTestSummary}>
        <span>
          <strong>{result.collections.length}</strong> collection{result.collections.length !== 1 ? "s" : ""}
        </span>
        <span>
          <strong>{totalItems}</strong> item{totalItems !== 1 ? "s" : ""}
        </span>
        <span>
          <strong>{formatDuration(result.durationMs)}</strong>
        </span>
        {(result.tokensIn || result.tokensOut) && (
          <span>
            tokens: <strong>{result.tokensIn ?? 0}</strong> in / <strong>{result.tokensOut ?? 0}</strong> out
          </span>
        )}
      </div>
      {result.cleanup && (
        <div className={styles.cleanupPreview}>
          {/* Both numbers, always: the gap between them is the whole point of
              the streak, and a single figure hides it. */}
          <strong>{result.cleanup.matched}</strong> item{result.cleanup.matched === 1 ? "" : "s"} match;{" "}
          <strong>{result.cleanup.dueThisRun}</strong> would be {result.cleanup.mode.replace("_", " ")}d on a real run;{" "}
          <strong>{result.cleanup.waiting}</strong> need more consecutive matches ({result.cleanup.consecutiveRuns} in a
          row).
          {result.cleanup.dryRun && " This rule is in preview-only mode, so a real run would act on none of them."}
          {result.cleanup.dueTitles.length > 0 && (
            <div className={styles.cleanupPreviewTitles}>{result.cleanup.dueTitles.join(", ")}</div>
          )}
        </div>
      )}
      {result.metadata && (
        <div className={styles.cleanupPreview}>
          {/* Grouped by field, because "change contentRating on 431 items" is
              the sentence someone needs before agreeing — a total across
              fields says nothing about what is about to happen. */}
          <strong>{result.metadata.writes}</strong> field write{result.metadata.writes === 1 ? "" : "s"} across{" "}
          <strong>{result.metadata.items}</strong> item{result.metadata.items === 1 ? "" : "s"}.
          {result.metadata.byField.length > 0 && (
            <div>
              {result.metadata.byField
                .map((f) => `${f.field} on ${f.count} item${f.count === 1 ? "" : "s"}`)
                .join(" · ")}
            </div>
          )}
          {result.metadata.blocked > 0 && (
            <div>
              {result.metadata.blocked} would be skipped — the field is locked to a different value and this rule
              doesn't overwrite locked fields.
            </div>
          )}
          {result.metadata.dryRun && " This rule is in preview-only mode, so a real run would write none of them."}
          {result.metadata.truncated && (
            <div>
              Showing the first {result.metadata.inspected} of {result.metadata.matched} matched items — a real run
              covers them all.
            </div>
          )}
          {result.metadata.diffs.length > 0 && (
            <div className={styles.cleanupPreviewTitles}>
              {result.metadata.diffs.map((d, i: number) => (
                <div key={i}>
                  {d.itemTitle} — {d.field}: {d.currentValue} → {d.newValue}
                  {d.blocked && " (locked, skipped)"}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {result.funnel && result.funnel.length > 0 && <FilterFunnel sections={result.funnel} />}
      {result.collections.length === 0 ? (
        <div className={styles.testPreviewEmpty}>
          {result.cleanup || result.metadata
            ? "Nothing matched this rule."
            : "No collections would be created by this rule."}
        </div>
      ) : stackWidth == null ? null : (
        <div className={styles.testPreviewStack} style={{ width: `${stackWidth}px` }}>
          {result.collections.map((col, i) => (
            <PreviewHubRow
              key={i}
              title={col.name}
              chips={
                <span className={styles.previewSectionMeta}>
                  {col.sectionTitle} · {col.items.length} item{col.items.length === 1 ? "" : "s"}
                </span>
              }
              items={col.items}
              onItemClick={(item) => navigate(`/media/${item.ratingKey}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
