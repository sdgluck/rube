import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import ToggleSwitch from "#components/ToggleSwitch";
import { CONFIG_SUMMARY, TYPE_BADGE, TYPE_LABELS } from "./constants";
import RuleDetailRow from "./DetailRow";
import RulePreviewRow from "./RulePreviewRow";
import StatusCell from "./StatusCell";
import styles from "./Rules.module.css";
import type { RuleRow } from "./types";

interface RuleTableRowProps {
  rule: RuleRow;
  index: number;
  selected: boolean;
  onCheckboxClick: (index: number, opts: { shiftKey: boolean }) => void;
  onToggleEnabled: () => void;
  isTesting: boolean;
  isRunning: boolean;
  isExpanded: boolean;
  highlighted?: boolean;
  onToggleRowExpand: () => void;
  previewExpanded: boolean;
  onTogglePreview: () => void;
  formActive: boolean;
  testPending: boolean;
  runPending: boolean;
  createPending: boolean;
  onRun: () => void;
  onCancelRun: () => void;
  onTest: () => void;
  onCancelTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDetailCleared: () => void;
}

export default function RuleTableRow({
  rule,
  index,
  selected,
  onCheckboxClick,
  onToggleEnabled,
  isTesting,
  isRunning,
  isExpanded,
  highlighted,
  onToggleRowExpand,
  previewExpanded,
  onTogglePreview,
  formActive,
  testPending,
  runPending,
  createPending,
  onRun,
  onCancelRun,
  onTest,
  onCancelTest,
  onEdit,
  onDuplicate,
  onDelete,
  onDetailCleared,
}: RuleTableRowProps) {
  const navigate = useNavigate();
  const c = rule.config ?? {};
  const summary = CONFIG_SUMMARY[rule.type]?.(c);
  const sections = (c as { sections?: string[] }).sections;
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (sections?.length) parts.push(`Sections: ${sections.join(", ")}`);
  const configSummary = parts.join(" | ") || "—";

  const typeBadge = TYPE_BADGE[rule.type] ?? styles.typeCriteria;
  const errorToShow =
    rule.lastRunAt && rule.lastRunStatus === "error"
      ? rule.lastRunError
      : rule.lastTestStatus === "error"
        ? rule.lastTestError
        : null;
  const expandable = !!errorToShow || rule.hasTestResult;
  const showDetail = isTesting || isRunning || (isExpanded && expandable);

  return (
    <Fragment>
      <tr data-rule-id={rule.id} className={highlighted ? styles.rowHighlighted : undefined}>
        <td className={styles.checkboxCell}>
          <input
            type="checkbox"
            aria-label={`Select ${rule.name}`}
            checked={selected}
            readOnly
            onClick={(e) => {
              onCheckboxClick(index, { shiftKey: e.shiftKey });
            }}
          />
        </td>
        <td>{rule.name}</td>
        <td>
          <span className={`${styles.typeLabel} ${typeBadge}`}>{TYPE_LABELS[rule.type] || rule.type}</span>
        </td>
        <td className={styles.toggleCell}>
          <ToggleSwitch checked={!!rule.enabled} onChange={onToggleEnabled} size="sm" />
        </td>
        <td className={styles.statusCell}>
          <StatusCell
            rule={rule}
            isTesting={isTesting}
            isRunning={isRunning}
            expanded={isExpanded}
            expandable={expandable}
            onToggle={onToggleRowExpand}
          />
        </td>
        <td>
          <span className={styles.configSummary}>{configSummary}</span>
        </td>
        <td>
          <div className={styles.actions}>
            {rule.lastCollectionRatingKey && (
              <button
                className={`${styles.actionBtn} ${previewExpanded ? styles.actionBtnActive : ""}`}
                onClick={onTogglePreview}
                title={previewExpanded ? "Hide preview" : "Preview last generated collection"}
              >
                Preview
              </button>
            )}
            {rule.lastCollectionRatingKey &&
              ((rule.lastRunCollectionCount ?? 0) > 1 ? (
                <button
                  className={styles.actionBtn}
                  onClick={() => navigate(`/collections?ruleId=${encodeURIComponent(rule.id)}`)}
                  title={`View ${rule.lastRunCollectionCount} collections from this rule`}
                >
                  View
                </button>
              ) : (
                <button
                  className={styles.actionBtn}
                  onClick={() => navigate(`/collections/${rule.lastCollectionRatingKey}`)}
                  title="View last generated collection"
                >
                  View
                </button>
              ))}
            {isRunning ? (
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={onCancelRun}>
                Cancel
              </button>
            ) : (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                onClick={onRun}
                disabled={runPending || testPending}
                title={runPending || testPending ? "Another rule is running" : "Generate collections in Plex"}
              >
                Run
              </button>
            )}
            {isTesting ? (
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={onCancelTest}>
                Cancel
              </button>
            ) : (
              <button
                className={styles.actionBtn}
                onClick={onTest}
                disabled={testPending || runPending}
                title={testPending || runPending ? "Another rule is running" : "Preview without writing to Plex"}
              >
                Test
              </button>
            )}
            <span className={styles.actionsDivider} />
            <button className={styles.actionBtn} onClick={onEdit} disabled={formActive} title="Edit rule">
              Edit
            </button>
            <button className={styles.actionBtn} onClick={onDuplicate} disabled={createPending} title="Duplicate rule">
              Duplicate
            </button>
            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={onDelete} title="Delete rule">
              Delete
            </button>
          </div>
        </td>
      </tr>
      {showDetail && (
        <RuleDetailRow
          ruleId={rule.id}
          isTesting={isTesting}
          isRunning={isRunning}
          errorToShow={errorToShow}
          onCleared={onDetailCleared}
        />
      )}
      {previewExpanded && rule.lastCollectionRatingKey && (
        <RulePreviewRow ruleId={rule.id} fallbackRatingKey={rule.lastCollectionRatingKey} />
      )}
    </Fragment>
  );
}
