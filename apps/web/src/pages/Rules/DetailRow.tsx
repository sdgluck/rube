import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FadeImage from "#components/FadeImage";
import { trpc } from "#/trpc";
import previewStyles from "#pages/Preview.module.css";
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
      <td ref={setTdEl} colSpan={7}>
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
      ) : stackWidth == null ? null : (
        <div className={styles.testPreviewStack} style={{ width: `${stackWidth}px` }}>
          {result.collections.map((col, i) => (
            <div key={i} className={styles.previewBlock}>
              <h4 className={styles.previewBlockTitle}>
                {col.name}
                <span className={styles.previewBlockMeta}>
                  {col.sectionTitle} · {col.items.length} item{col.items.length === 1 ? "" : "s"}
                </span>
              </h4>
              <div className={styles.testPreviewPosterRow}>
                {col.items.map((item) => {
                  const src = item.thumb ? `/api/plex-image?path=${encodeURIComponent(item.thumb)}` : null;
                  return (
                    <div
                      key={item.ratingKey}
                      className={previewStyles.card}
                      onClick={() => navigate(`/media/${item.ratingKey}`)}
                    >
                      <div className={previewStyles.posterWrap}>
                        {src ? (
                          <FadeImage className={previewStyles.poster} src={src} alt={item.title} loading="lazy" />
                        ) : (
                          <div className={previewStyles.posterPlaceholder}>No image</div>
                        )}
                      </div>
                      <div className={previewStyles.cardTitle} title={item.title}>
                        {item.title}
                      </div>
                      {item.year != null && <div className={previewStyles.cardMeta}>{item.year}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
