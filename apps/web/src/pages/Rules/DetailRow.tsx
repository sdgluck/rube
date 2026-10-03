import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PreviewHubRow } from "#components/PreviewHubRow";
import { trpc } from "#/trpc";
import FilterFunnel from "./FilterFunnel";
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
        {(result.cleanup?.dryRun || result.metadata?.dryRun) && (
          <span className={styles.previewOnlyBadge} title="A real run of this rule changes nothing">
            Preview only
          </span>
        )}
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
          {result.metadata.blocked > 0 && <div>{result.metadata.blocked} skipped — locked to a different value.</div>}
          {result.metadata.truncated && (
            <div>
              First {result.metadata.inspected} of {result.metadata.matched} matched items; a real run covers all.
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
