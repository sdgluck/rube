import { Fragment } from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FileClock,
  FlaskConical,
  History,
  ImageOff,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import {
  describeRuleWindow,
  describeSchedule,
  parseSchedule,
  RULE_TRIGGER_CADENCE,
  RULE_TRIGGER_NOTES,
  type RuleSchedule,
  type RuleTrigger,
} from "@tinkerbell/contracts";
import { EMPTY } from "#/format";
import { trpc } from "#/trpc";
import { Link, useNavigate } from "react-router-dom";
import RowActions from "#components/RowActions";
import ToggleSwitch from "#components/ToggleSwitch";
import { CONFIG_SUMMARY, summarizeSmartFilterTree, TYPE_BADGE, TYPE_LABELS } from "./constants";

/**
 * Badge text per trigger. Shorter than `RULE_TRIGGER_LABELS`, which are
 * sentences for a checkbox — a table cell wants two words, with the sentence
 * on the tooltip.
 */
const TRIGGER_BADGES: Record<RuleTrigger, string> = {
  "item-added": "on new items",
  "item-watched": "on watched",
  "item-removed": "on removed",
  "request-fulfilled": "on requests",
};
import RuleDetailRow from "./DetailRow";
import RulePreviewRow from "./RulePreviewRow";
import RuleHistoryRow from "./RuleHistoryRow";
import StatusCell from "./StatusCell";
import styles from "./Rules.module.css";
import type { RuleRow } from "./types";

/**
 * The badges for a rule that doesn't simply run nightly.
 *
 * On the row rather than behind the expander because "why didn't this run?"
 * is a question asked while scanning the list, and a seasonal rule sitting at
 * zero collections in March is the exact thing that prompts it.
 */
function ScheduleBadges({ config }: { config: unknown }) {
  const schedule = (config as { schedule?: RuleSchedule } | null)?.schedule;
  if (!schedule) return null;
  const window = describeRuleWindow(schedule);
  return (
    <>
      {schedule.cron && (
        <span
          className={styles.scheduleBadge}
          title={
            schedule.excludeFromBatch
              ? `Runs only on its own schedule: ${schedule.cron}`
              : `Runs nightly and on its own schedule: ${schedule.cron}`
          }
        >
          {describeSchedule(parseSchedule(schedule.cron))}
        </span>
      )}
      {window && (
        <span
          className={styles.scheduleBadge}
          title={`Only runs ${window} each year. Outside that its collections are removed.`}
        >
          {window}
        </span>
      )}
      {(schedule.triggers ?? []).map((trigger) => (
        <span
          key={trigger}
          className={styles.scheduleBadge}
          title={`${RULE_TRIGGER_NOTES[trigger]} (${RULE_TRIGGER_CADENCE[trigger]})`}
        >
          {TRIGGER_BADGES[trigger]}
        </span>
      ))}
      {(schedule.afterRules?.length ?? 0) > 0 && <ChainedBadge afterRules={schedule.afterRules ?? []} />}
    </>
  );
}

/**
 * "chained", with the rules it waits on named in the tooltip — "after another
 * rule" leaves the reader to open the editor to find out which. Reads the
 * list the page has already loaded, so it costs no request.
 */
function ChainedBadge({ afterRules }: { afterRules: string[] }) {
  const rulesQuery = trpc.rules.list.useQuery();
  const names = afterRules.map((id) => rulesQuery.data?.find((r) => r.id === id)?.name ?? "a deleted rule");
  return (
    <span className={styles.scheduleBadge} title={`Runs after ${names.join(", ")}`}>
      chained
    </span>
  );
}

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
  historyExpanded: boolean;
  onToggleHistory: () => void;
  formActive: boolean;
  /** The in-flight run's id, when this rule has one. Null when idle. */
  activeRunId: string | null;
  /** 0–1, for the inline "Running… 62%" readout. */
  runProgress: number;
  /** Where this rule's run history lives. */
  runsHref: string;
  createPending: boolean;
  onRun: () => void;
  onCancelRun: () => void;
  onTest: () => void;
  onCancelTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDetailCleared: () => void;
  /** True when this rule's config asks for generated collection artwork. */
  generatesArtwork: boolean;
  onRevertArtwork?: () => void;
  /** Resolves per-server tag keys to names for the Config summary. */
  resolveTag?: (field: string, value: string) => string;
  /** Queue tallies, set only when this rule's outcome is cleanup. */
  cleanup?: { queued: number; actioned: number };
  /** Rules whose ending is a metadata write build no collections either. */
  isMetadata?: boolean;
  /**
   * Whether the running order can be dragged right now.
   *
   * False whenever a filter, a search or another sort is in force: dropping a
   * row into a list showing eight of forty rules would have to guess what
   * "third" meant among the thirty-two it is not showing.
   */
  canReorder?: boolean;
  /**
   * Zero-based place in the running order *of this page's rules*.
   *
   * Not `rule.position`: that counts across every rule in the install, and each
   * Rules page shows one ending. The only cleanup rule on a install with one
   * collection rule sits at position 1 and would otherwise be labelled "2".
   */
  orderIndex: number;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropOn?: () => void;
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
  historyExpanded,
  onToggleHistory,
  formActive,
  activeRunId,
  runProgress,
  runsHref,
  createPending,
  onRun,
  onCancelRun,
  onTest,
  onCancelTest,
  onEdit,
  onDuplicate,
  onDelete,
  generatesArtwork,
  onRevertArtwork,
  onDetailCleared,
  resolveTag,
  cleanup,
  isMetadata,
  canReorder,
  orderIndex,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropOn,
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
      <tr
        data-rule-id={rule.id}
        className={isDragging ? styles.dragging : undefined}
        draggable={canReorder}
        onDragStart={
          canReorder
            ? (e) => {
                // Chrome and Firefox abandon a drag whose data store is empty,
                // so the row has to put something on the transfer even though
                // the drop reads the dragged id from state, not from here.
                e.dataTransfer.setData("text/plain", rule.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart?.();
              }
            : undefined
        }
        onDragEnd={onDragEnd}
        onDragOver={
          canReorder
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            : undefined
        }
        onDrop={
          canReorder
            ? (e) => {
                e.preventDefault();
                onDropOn?.();
              }
            : undefined
        }
      >
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
        <td className={styles.orderCell} data-cell="hide">
          {canReorder ? (
            <span className={styles.dragHandle} aria-hidden="true" title="Drag to change when this rule runs">
              ⠿
            </span>
          ) : (
            <span className={styles.dragHandle} title="Sort by Order to rearrange">
              {orderIndex + 1}
            </span>
          )}
        </td>
        <td data-cell="title">
          {rule.name}
          {rule.registryPackSlug && (
            <span className={styles.registryBadge} title={`Imported from the "${rule.registryPackSlug}" registry pack`}>
              registry
            </span>
          )}
          <ScheduleBadges config={rule.config} />
        </td>
        <td data-cell="pill">
          <span className={`${styles.typeLabel} ${typeBadge}`}>{TYPE_LABELS[rule.type] || rule.type}</span>
        </td>
        <td className={styles.toggleCell} data-cell="hide">
          <ToggleSwitch checked={!!rule.enabled} onChange={onToggleEnabled} size="sm" />
        </td>
        <td className={styles.statusCell} data-cell="meta">
          <StatusCell
            rule={rule}
            isTesting={isTesting}
            isRunning={isRunning}
            runProgress={runProgress}
            cleanup={cleanup}
            isMetadata={isMetadata}
          />
        </td>
        <td className={styles.runsCell} data-cell="hide">
          <Link to={runsHref} className={styles.runsLink} title={`Run history for ${rule.name}`}>
            {rule.runCount > 0 ? `${rule.runCount} run${rule.runCount === 1 ? "" : "s"}` : "No runs"}
            <ChevronRight size="1.4rem" aria-hidden />
          </Link>
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
                    title: "Generate collections in Plex",
                    icon: Play,
                    inline: true,
                    primary: true,
                    onSelect: onRun,
                  },
              isTesting
                ? { label: "Cancel test", icon: Square, danger: true, onSelect: onCancelTest }
                : {
                    label: "Test",
                    title: "Preview without writing to Plex",
                    icon: FlaskConical,
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
              // Only for a rule that has artwork turned on — for every other
              // rule there is nothing to revert, and an action that always
              // reports "nothing to do" teaches people to ignore it.
              ...(generatesArtwork && onRevertArtwork
                ? [{ label: "Revert artwork", icon: ImageOff, danger: true, onSelect: onRevertArtwork }]
                : []),
              { label: "View runs", icon: History, onSelect: () => navigate(runsHref) },
              // Distinct from "View runs", which is what the rule *did*. This
              // is what was done *to* the rule, and the two get confused if
              // they aren't adjacent and differently worded.
              {
                label: historyExpanded ? "Hide change history" : "Change history",
                icon: FileClock,
                onSelect: onToggleHistory,
              },
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
          runId={activeRunId}
          isTesting={isTesting}
          isRunning={isRunning}
          errorToShow={errorToShow}
          onCleared={onDetailCleared}
        />
      )}
      {previewExpanded && hasGeneratedCollection && (
        <RulePreviewRow ruleId={rule.id} fallbackRatingKey={rule.lastCollectionRatingKey!} />
      )}
      {historyExpanded && <RuleHistoryRow ruleId={rule.id} />}
    </Fragment>
  );
}
