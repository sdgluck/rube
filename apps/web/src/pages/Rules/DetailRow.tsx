import { trpc } from "#/trpc";
import InlineProgress from "./InlineProgress";
import styles from "./Rules.module.css";
import { formatDuration } from "./utils";

interface RuleDetailRowProps {
  ruleId: string;
  isTesting: boolean;
  isRunning: boolean;
  errorToShow: string | null;
  onCleared: () => void;
}

export default function RuleDetailRow({ ruleId, isTesting, isRunning, errorToShow, onCleared }: RuleDetailRowProps) {
  const resultQuery = trpc.rules.lastTestResult.useQuery({ id: ruleId }, { enabled: !isRunning });
  const hasResult = !!resultQuery.data;
  const showAnything = isTesting || isRunning || !!errorToShow || hasResult;
  if (!showAnything) return null;

  return (
    <tr className={styles.detailRow}>
      <td colSpan={7}>
        <div className={styles.detailWrap}>
          {(isTesting || isRunning) && <InlineProgress ruleId={ruleId} phase={isTesting ? "test" : "run"} />}
          {!isTesting && !isRunning && errorToShow && (
            <div style={{ marginBottom: 12 }}>
              <div className={styles.detailHeader}>
                <span className={styles.detailTitle}>Last error</span>
              </div>
              <div className={styles.errorBox}>{errorToShow}</div>
            </div>
          )}
          {!isRunning && <TestResultsBlock ruleId={ruleId} onCleared={onCleared} />}
        </div>
      </td>
    </tr>
  );
}

interface TestResultsBlockProps {
  ruleId: string;
  onCleared?: () => void;
}

function TestResultsBlock({ ruleId, onCleared }: TestResultsBlockProps) {
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
      {result.collections.length === 0 ? (
        <div className={styles.testPreviewEmpty}>No collections would be created by this rule.</div>
      ) : (
        result.collections.map((col, i) => (
          <div key={i} className={styles.testPreviewCollection}>
            <div className={styles.testPreviewCollectionHeader}>
              <span className={styles.testPreviewCollectionName}>{col.name}</span>
              <span className={styles.testPreviewCollectionMeta}>
                {col.sectionTitle} — {col.items.length} item{col.items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className={styles.testPreviewItems}>
              {col.items.map((item, j) => (
                <div key={j} className={styles.testPreviewItem}>
                  {item.title}
                  {item.year && <span className={styles.testPreviewItemYear}> ({item.year})</span>}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
