import { fieldKind, fieldLabel, SMART_FILTER_FIELD_DEFS } from "@rube/contracts";
import { hasLocalLeaves, isLocalField } from "@rube/plex-smart-filter";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SettingsPageLink from "#components/SettingsPageLink";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import FilterValueInput from "#components/smart-filter/FilterValueInput.tsx";
import {
  LOCAL_FIELD_GROUP_LABEL,
  LOCAL_FIELD_GROUP_NOTE,
  LOCAL_FIELD_HINTS,
} from "#components/smart-filter/UserValueSelect.tsx";
import { opsFor, withFallbackOp } from "@rube/contracts";
import {
  buildPresetFilter,
  cleanupPreset,
  presetFromFilter,
  type CleanupPreset,
} from "#pages/Rules/RuleWizard/cleanup-presets.ts";
import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import type {
  SmartFilterGroup,
  SmartFilterLeaf,
  SmartFilterNode,
  SmartFilterOp,
  SourceStepProps,
} from "#pages/Rules/RuleWizard/types.ts";

/**
 * Edit a recursive AND/OR tree of clauses. The wizard mirrors the
 * shape that the importer produces and the runtime emitter consumes:
 * leaves are field/op/value triples; groups combine children with `all`
 * (AND) or `any` (OR) and can nest. The root is always a group, even
 * with one child, so the user can always toggle AND/OR at the top.
 *
 * Editing model: render leaves as a row with field/op/value selects,
 * groups as a bordered block with the combinator toggle and Add-clause
 * / Add-group / Remove buttons. Mutations hand back a new tree —
 * setForm replaces the whole `smartFilter` field on each edit so React
 * sees a stable reference change.
 */
export default function SmartFilterSource({ form, setForm, tagSectionId = null }: SourceStepProps) {
  const setRoot = (next: SmartFilterGroup) => setForm({ ...form, smartFilter: next });
  const usesWatchHistory = hasLocalLeaves(form.smartFilter);
  const preset = cleanupPreset(form.cleanupPreset);

  // A preset has already written the clauses; all that is left is its one
  // number. The full tree is one click away and the same rule either way.
  if (preset) return <PresetEditor form={form} setForm={setForm} preset={preset} />;

  return (
    <>
      <h3 className={styles.stepHeading}>Smart filter</h3>
      {usesWatchHistory && <WatchHistoryWarning />}
      {/* Only a collection rule has a collection to name; a cleanup or
          metadata rule's matches never become one. */}
      {form.outcome.kind === "collection" && (
        <div className={styles.field}>
          <label htmlFor="rule-smart-filter-name">Collection name (optional)</label>
          <input
            id="rule-smart-filter-name"
            className={shared.input}
            value={form.collectionName}
            onChange={(e) => setForm({ ...form, collectionName: e.target.value })}
            placeholder="Smart Filter"
          />
        </div>
      )}
      <DescribeFilter current={form.smartFilter} sectionId={tagSectionId} onDraft={setRoot} />
      <div className={styles.field}>
        <label>Filter</label>
        <GroupEditor group={form.smartFilter} onChange={setRoot} depth={0} sectionId={tagSectionId} />
      </div>
    </>
  );
}

// ─── Describe it ─────────────────────────────────────────────────────────────

/**
 * A sentence in, clauses out — straight into the editor below, where they are
 * the admin's to read and change like any others. Nothing is saved here.
 *
 * Replacing a filter someone already built is one click from being undone:
 * the tree it replaced is kept until the next draft, rather than asking first
 * and making the common case — an empty filter — pay for the rare one.
 */
function DescribeFilter({
  current,
  sectionId,
  onDraft,
}: {
  current: SmartFilterGroup;
  sectionId: string | null;
  onDraft: (next: SmartFilterGroup) => void;
}) {
  const { addToast } = useToast();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [previous, setPrevious] = useState<SmartFilterGroup | null>(null);
  const availability = trpc.rules.draftAvailability.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const draft = trpc.rules.draftFilter.useMutation();
  const unavailable = availability.data?.unavailableReason ?? null;

  if (!availability.data) return null;

  const submit = () => {
    if (!sectionId) return;
    draft.mutate(
      { description: text, sectionId },
      {
        onSuccess: (result) => {
          setPrevious(current.children.length > 0 ? current : null);
          setNotes(result.notes);
          onDraft(result.filter);
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  };

  return (
    <div className={styles.field}>
      <label htmlFor="rule-smart-filter-describe">Describe it (optional)</label>
      <textarea
        id="rule-smart-filter-describe"
        className={shared.textarea}
        rows={2}
        value={text}
        maxLength={1000}
        disabled={!!unavailable || draft.isPending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) submit();
        }}
        placeholder="e.g. 90s action films under two hours that nobody has watched"
      />
      {unavailable ? (
        <span className={styles.hint}>
          {unavailable} <SettingsPageLink to="/settings/ai" />.
        </span>
      ) : (
        <span style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.6rem" }}>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            disabled={draft.isPending || !sectionId || text.trim().length < 3}
            onClick={submit}
          >
            {draft.isPending ? "Drafting…" : "Draft filter"}
          </button>
          {previous && !draft.isPending && (
            <button
              type="button"
              className={styles.summaryEdit}
              onClick={() => {
                onDraft(previous);
                setPrevious(null);
                setNotes([]);
              }}
            >
              Undo — put back the filter it replaced
            </button>
          )}
          <span className={styles.hint} style={{ margin: 0 }}>
            The AI writes the clauses below. Check them before saving.
          </span>
        </span>
      )}
      {notes.length > 0 && (
        <ul className={styles.hint} role="status" style={{ margin: "0.6rem 0 0", paddingLeft: "1.6rem" }}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Cleanup presets ─────────────────────────────────────────────────────────

/**
 * One preset, one number.
 *
 * The escape hatch is deliberately not a mode switch: dropping the preset
 * reveals the tree it built, already populated, so "edit as a full smart
 * filter" continues from where the preset got to rather than starting over.
 * It is one-way — once the clauses are yours, re-applying the preset would
 * throw them away without saying so.
 */
function PresetEditor({
  form,
  setForm,
  preset,
}: {
  form: SourceStepProps["form"];
  setForm: SourceStepProps["setForm"];
  preset: CleanupPreset;
}) {
  const current = presetFromFilter(form.smartFilter)?.amount ?? preset.knobDefault;

  const setAmount = (raw: number) => {
    const amount = Math.min(preset.knobMax, Math.max(preset.knobMin, Math.round(raw) || preset.knobMin));
    setForm({ ...form, smartFilter: buildPresetFilter(preset, amount) });
  };

  return (
    <>
      <h3 className={styles.stepHeading}>{preset.label}</h3>
      <WatchHistoryWarning />
      <div className={styles.field}>
        <label htmlFor="cleanup-preset-knob">{preset.knobLabel}</label>
        <span style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <input
            id="cleanup-preset-knob"
            type="number"
            className={shared.input}
            style={{ width: "11rem" }}
            min={preset.knobMin}
            max={preset.knobMax}
            value={current}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <span className={styles.hint} style={{ margin: 0 }}>
            {preset.knob === "days" ? "days" : "% of the way through"}
          </span>
        </span>
        {preset.note && (
          <p className={styles.hint} style={{ marginTop: "0.6rem" }}>
            {preset.note}
          </p>
        )}
      </div>
      <button
        type="button"
        className={styles.summaryEdit}
        style={{ alignSelf: "flex-start" }}
        onClick={() => setForm({ ...form, cleanupPreset: undefined })}
      >
        Edit as a full smart filter
      </button>
    </>
  );
}

// ─── Watch-history coverage ──────────────────────────────────────────────────

/** Below either of these, a watch-history filter is answering from thin air. */
const MIN_SESSIONS = 50;
const MIN_DAYS = 7;

/**
 * The single most likely support question about this feature.
 *
 * A user adds "watched by nobody", gets their entire library back, and
 * concludes the filter is broken — when in fact Rube has been recording
 * plays for two days. Saying so up front costs one line.
 */
function WatchHistoryWarning() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const backfill = trpc.jobs.start.useMutation();
  const coverage = trpc.stats.watchHistoryCoverage.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  if (!coverage.data) return null;

  const { sessions, days } = coverage.data;
  if (sessions >= MIN_SESSIONS && days >= MIN_DAYS) return null;

  const recorded =
    sessions === 0
      ? "no plays yet"
      : `${sessions} play${sessions === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}`;

  return (
    <div className={styles.field} role="status">
      <span
        className={styles.chipOff}
        title={`"Watched by nobody" will match almost everything until the history fills up.`}
      >
        Watch history is thin — {recorded}
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
          disabled={backfill.isPending}
          onClick={() =>
            backfill.mutate(
              { jobId: "playback-backfill" },
              {
                // A toast rather than a redirect: leaving now would throw away
                // the rule half-built in this wizard.
                onSuccess: ({ runId }) =>
                  addToast("Backfill started", "success", {
                    action: { label: "View job", onAction: () => navigate(`/jobs/runs/${runId}`) },
                  }),
                onError: (err) => addToast(err.message, "error"),
              },
            )
          }
        >
          {backfill.isSuccess ? "Backfill started" : "Backfill"}
        </button>
      </span>
    </div>
  );
}

// ─── Groups ──────────────────────────────────────────────────────────────────

interface GroupEditorProps {
  group: SmartFilterGroup;
  onChange: (next: SmartFilterGroup) => void;
  /** 0 = root. Root group can't be removed; subgroups can. */
  depth: number;
  /** Section whose tag values populate the genre/studio/… pickers. */
  sectionId: string | null;
  /**
   * True when this group, or one containing it, combines with OR. Watch-history
   * fields can't live there — see `splitLocalLeaves`.
   */
  underOr?: boolean;
  onRemove?: () => void;
  /**
   * Library fields only. A grouped rule's scope runs as one Plex query, so a
   * watch-history field — evaluated per person, after the query — can't go in it.
   */
  plexOnly?: boolean;
}

/** The AND/OR clause editor, for a grouped rule's scope as well as a smart filter. */
export function GroupEditor({
  group,
  onChange,
  depth,
  sectionId,
  underOr = false,
  onRemove,
  plexOnly = false,
}: GroupEditorProps) {
  const updateChild = (i: number, next: SmartFilterNode) => {
    onChange({ ...group, children: group.children.map((c, idx) => (idx === i ? next : c)) });
  };
  const removeChild = (i: number) => {
    onChange({ ...group, children: group.children.filter((_, idx) => idx !== i) });
  };
  const addClause = () => {
    onChange({
      ...group,
      children: [...group.children, { kind: "leaf", field: "genre", op: "=", value: "" }],
    });
  };
  const addGroup = () => {
    onChange({
      ...group,
      children: [
        ...group.children,
        { kind: "group", combinator: group.combinator === "all" ? "any" : "all", children: [] },
      ],
    });
  };
  const flipCombinator = () => {
    onChange({ ...group, combinator: group.combinator === "all" ? "any" : "all" });
  };

  // A combinator only means something once the group has two children — `any`
  // of one is identity, and a freshly added group starts empty. Matching the
  // rule `splitLocalLeaves` applies keeps the editor and the validator from
  // disagreeing about whether a tree is savable.
  const childrenUnderOr = underOr || (group.combinator === "any" && group.children.length > 1);

  // Visual nesting: alternate left-border tint per depth so deeply-nested
  // groups read as a hierarchy rather than a wall of inputs.
  const borderStyle: React.CSSProperties = {
    borderLeft: `0.3rem solid ${depth % 2 === 0 ? "var(--accent)" : "var(--line)"}`,
    paddingLeft: "1.2rem",
    marginLeft: depth === 0 ? 0 : 4,
  };

  return (
    <div style={{ ...borderStyle, display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
        <button
          type="button"
          className={styles.summaryEdit}
          onClick={flipCombinator}
          aria-label={`Toggle group combinator (currently ${group.combinator === "all" ? "AND" : "OR"})`}
          title="Click to toggle AND / OR"
        >
          {group.combinator === "all" ? "Match ALL of (AND)" : "Match ANY of (OR)"}
        </button>
        {depth > 0 && onRemove && (
          <button type="button" className={styles.summaryEdit} onClick={onRemove} aria-label="Remove group">
            Remove group
          </button>
        )}
      </div>
      {group.children.length === 0 && (
        <p className={styles.hint} style={{ margin: 0, fontStyle: "italic" }}>
          No clauses yet — add one below.
        </p>
      )}
      {group.children.map((child, i) =>
        child.kind === "leaf" ? (
          <LeafEditor
            key={i}
            leaf={child}
            sectionId={sectionId}
            underOr={childrenUnderOr}
            plexOnly={plexOnly}
            onChange={(next) => updateChild(i, next)}
            onRemove={() => removeChild(i)}
          />
        ) : (
          <GroupEditor
            key={i}
            group={child}
            onChange={(next) => updateChild(i, next)}
            depth={depth + 1}
            sectionId={sectionId}
            underOr={childrenUnderOr}
            plexOnly={plexOnly}
            onRemove={() => removeChild(i)}
          />
        ),
      )}
      <div style={{ display: "flex", gap: "0.8rem" }}>
        <button type="button" className={styles.summaryEdit} onClick={addClause}>
          + Add clause
        </button>
        <button type="button" className={styles.summaryEdit} onClick={addGroup}>
          + Add group
        </button>
      </div>
    </div>
  );
}

interface LeafEditorProps {
  leaf: SmartFilterLeaf;
  sectionId: string | null;
  /** True when the enclosing group — or one above it — combines with OR. */
  underOr: boolean;
  plexOnly: boolean;
  onChange: (next: SmartFilterLeaf) => void;
  onRemove: () => void;
}

const FIELD_OPTIONS = SMART_FILTER_FIELD_DEFS.filter((d) => !d.advanced && d.source !== "local");
const LOCAL_FIELD_OPTIONS = SMART_FILTER_FIELD_DEFS.filter((d) => d.source === "local");

const OR_DISABLED_REASON =
  "Watch-history fields only work with AND. Inside an OR group, Plex would never return the items this filter needs to check.";

function LeafEditor({ leaf, sectionId, underOr, plexOnly, onChange, onRemove }: LeafEditorProps) {
  const ops = withFallbackOp(opsFor(leaf.field), leaf.op);
  const isLocal = isLocalField(leaf.field);
  // An existing local leaf whose group was flipped to OR after the fact. The
  // save will be refused, so say why here rather than at the end of the wizard.
  const invalid = isLocal && underOr;

  const updateField = (field: string) => {
    // Keep the operator only if it still means something for the new field's
    // kind, and drop a value that belonged to the old one.
    const op: SmartFilterOp = opsFor(field).some((o) => o.op === leaf.op) ? leaf.op : "=";
    onChange({ ...leaf, field, op, value: fieldKind(field) === "boolean" ? "1" : "" });
  };

  return (
    <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
      <select
        className={shared.input}
        style={{ flex: "0 0 18rem" }}
        value={leaf.field}
        onChange={(e) => updateField(e.target.value)}
        aria-label="Field"
        aria-invalid={invalid || undefined}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
        {/* Grouped separately, and disabled rather than hidden inside an OR:
            a field that vanishes reads as a bug, where a greyed one with a
            reason attached reads as a rule. */}
        {!plexOnly && (
          <optgroup label={underOr ? `${LOCAL_FIELD_GROUP_LABEL} (needs AND)` : LOCAL_FIELD_GROUP_LABEL}>
            {LOCAL_FIELD_OPTIONS.map((f) => (
              <option
                key={f.field}
                value={f.field}
                disabled={underOr && f.field !== leaf.field}
                title={underOr ? OR_DISABLED_REASON : LOCAL_FIELD_HINTS.get(f.field)}
              >
                {f.label}
              </option>
            ))}
          </optgroup>
        )}
        {/* Preserve the imported field even if it's outside the curated list, so
            migrated rules with fields like `show.network` round-trip cleanly. */}
        {!SMART_FILTER_FIELD_DEFS.some((f) => f.field === leaf.field) && (
          <option value={leaf.field}>{fieldLabel(leaf.field)}</option>
        )}
      </select>
      <select
        className={shared.input}
        style={{ flex: "0 0 14rem" }}
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as SmartFilterOp })}
        aria-label="Operator"
      >
        {ops.map((op) => (
          <option key={op.op} value={op.op}>
            {op.label}
          </option>
        ))}
      </select>
      {/* Rules travel between servers, so tag values are stored as display
          names — `domains/registry/src/resolve.ts` turns them into per-server
          keys when the rule runs. */}
      <FilterValueInput
        field={leaf.field}
        value={leaf.value}
        sectionId={sectionId}
        tagMode="title"
        inputClassName={shared.input}
        selectClassName={shared.input}
        onChange={(value) => onChange({ ...leaf, value })}
      />
      <button type="button" className={styles.summaryEdit} onClick={onRemove} aria-label="Remove clause">
        Remove
      </button>
      {invalid ? (
        <p
          className={styles.errorText}
          style={{ margin: 0, flexBasis: "100%" }}
          role="alert"
          title={OR_DISABLED_REASON}
        >
          Watch-history fields need an AND group.
        </p>
      ) : (
        isLocal && (
          <p className={styles.hint} style={{ margin: 0, flexBasis: "100%" }} title={LOCAL_FIELD_GROUP_NOTE}>
            {LOCAL_FIELD_HINTS.get(leaf.field)}
          </p>
        )
      )}
    </div>
  );
}
