import { Fragment } from "react";
import { Copy, ExternalLink, Eye, FlaskConical, Pencil, Play, Square, Trash2 } from "lucide-react";
import { EMPTY } from "#/format";
import { useNavigate } from "react-router-dom";
import RowActions from "#components/RowActions";
import ToggleSwitch from "#components/ToggleSwitch";
import { CONFIG_SUMMARY, summarizeSmartFilterTree, TYPE_BADGE, TYPE_LABELS } from "./constants";
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
  /** Resolves per-server tag keys to names for the Config summary. */
  resolveTag?: (field: string, value: string) => string;
  /** Queue tallies, set only when this rule's outcome is cleanup. */
  cleanup?: { queued: number; actioned: number };
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
  resolveTag,
  cleanup,
}: RuleTableRowProps) {
  const navigate = useNavigate();
  const c = rule.config ?? {};
  const summary =
    rule.type === "smart_filter" ? summarizeSmartFilterTree(c.smartFilter, resolveTag) : CONFIG_SUMMARY[rule.type]?.(c);
  const sections = (c as { sections?: string[] }).sections;
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (sections?.length) parts.push(`Sections: ${sections.join(", ")}`);
  const configSummary = parts.join(" | ") || EMPTY;

  const typeBadge = TYPE_BADGE[rule.type] ?? styles.typeCriteria;
  const errorToShow =
    rule.lastRunAt && rule.lastRunStatus === "error"
      ? rule.lastRunError
      : rule.lastTestStatus === "error"
        ? rule.lastTestError
        : null;
  const expandable = !!errorToShow || rule.hasTestResult;
  const showDetail = isTesting || isRunning || (isExpanded && expandable);
  // A collection only really exists on Plex when the last run finished `ok`;
  // a stale `lastCollectionRatingKey` from a cancelled/error run points at
  // metadata that 404s.
  const hasGeneratedCollection = !!rule.lastCollectionRatingKey && rule.lastRunStatus === "ok";

  return (
    <Fragment>
      <tr data-rule-id={rule.id}>
        <td className={styles.checkboxCell} data-cell="hide">
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
        <td data-cell="title">
          {rule.name}
          {rule.registryPackSlug && (
            <span className={styles.registryBadge} title={`Imported from the "${rule.registryPackSlug}" registry pack`}>
              registry
            </span>
          )}
        </td>
        <td data-cell="pill">
          <span className={`${styles.typeLabel} ${typeBadge}`}>{TYPE_LABELS[rule.type] || rule.type}</span>
        </td>
        <td className={styles.toggleCell} data-cell="hide">
          <ToggleSwitch checked={!!rule.enabled} onChange={onToggleEnabled} size="sm" />
        </td>
        <td className={styles.statusCell} data-cell="meta">
          <StatusCell rule={rule} isTesting={isTesting} isRunning={isRunning} cleanup={cleanup} />
        </td>
        <td data-cell="hide">
          <span className={styles.configSummary}>{configSummary}</span>
        </td>
        <td data-cell="hide">
          <RowActions
            label={`Actions for ${rule.name}`}
            actions={[
              // Run is the row's verb, so it stays inline; while a run is in
              // flight the same slot is how you stop it.
              isRunning
                ? {
                    label: "Cancel run",
                    icon: Square,
                    inline: true,
                    danger: true,
                    onSelect: onCancelRun,
                  }
                : {
                    label: "Run",
                    title: runPending || testPending ? "Another rule is running" : "Generate collections in Plex",
                    icon: Play,
                    inline: true,
                    primary: true,
                    disabled: runPending || testPending,
                    onSelect: onRun,
                  },
              isTesting
                ? { label: "Cancel test", icon: Square, danger: true, onSelect: onCancelTest }
                : {
                    label: "Test",
                    title: testPending || runPending ? "Another rule is running" : "Preview without writing to Plex",
                    icon: FlaskConical,
                    disabled: testPending || runPending,
                    onSelect: onTest,
                  },
              // Preview / View only make sense when the last run actually
              // produced a collection. A `lastCollectionRatingKey` left over
              // from a cancelled or failed run points at metadata that no
              // longer exists on Plex (or never did) — gate on `lastRunStatus`
              // so users don't get a 404 the moment they click.
              ...(hasGeneratedCollection
                ? [
                    {
                      label: previewExpanded ? "Hide preview" : "Preview",
                      icon: Eye,
                      onSelect: onTogglePreview,
                    },
                    (rule.lastRunCollectionCount ?? 0) > 1
                      ? {
                          label: `View ${rule.lastRunCollectionCount} collections`,
                          icon: ExternalLink,
                          onSelect: () => navigate(`/collections?ruleId=${encodeURIComponent(rule.id)}`),
                        }
                      : {
                          label: "View collection",
                          icon: ExternalLink,
                          onSelect: () => navigate(`/collections/${rule.lastCollectionRatingKey}`),
                        },
                  ]
                : []),
              { label: "Edit", icon: Pencil, disabled: formActive, onSelect: onEdit },
              { label: "Duplicate", icon: Copy, disabled: createPending, onSelect: onDuplicate },
              { label: "Delete", icon: Trash2, danger: true, onSelect: onDelete },
            ]}
          />
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
      {previewExpanded && hasGeneratedCollection && (
        <RulePreviewRow ruleId={rule.id} fallbackRatingKey={rule.lastCollectionRatingKey!} />
      )}
    </Fragment>
  );
}
