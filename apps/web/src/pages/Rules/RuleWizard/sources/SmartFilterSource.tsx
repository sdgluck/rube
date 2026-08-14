import { fieldKind, fieldLabel, SMART_FILTER_FIELD_DEFS } from "@tinkerbell/contracts";
import shared from "#/styles/shared.module.css";
import FilterValueInput from "#components/smart-filter/FilterValueInput.tsx";
import { opsFor, withFallbackOp } from "#components/smart-filter/ops.ts";
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

  return (
    <>
      <h3 className={styles.stepHeading}>Smart filter</h3>
      <p className={styles.stepSub}>
        Build the criteria the rule will use to query Plex. Combine clauses with AND / OR, and nest groups for more
        complex queries (e.g. <em>(director = Lynch OR Nolan) AND year ≥ 2000</em>). One collection per section is
        created from the matching items each time the rule runs.
      </p>
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
      <div className={styles.field}>
        <label>Filter</label>
        <GroupEditor group={form.smartFilter} onChange={setRoot} depth={0} sectionId={tagSectionId} />
      </div>
    </>
  );
}

interface GroupEditorProps {
  group: SmartFilterGroup;
  onChange: (next: SmartFilterGroup) => void;
  /** 0 = root. Root group can't be removed; subgroups can. */
  depth: number;
  /** Section whose tag values populate the genre/studio/… pickers. */
  sectionId: string | null;
  onRemove?: () => void;
}

function GroupEditor({ group, onChange, depth, sectionId, onRemove }: GroupEditorProps) {
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

  // Visual nesting: alternate left-border tint per depth so deeply-nested
  // groups read as a hierarchy rather than a wall of inputs.
  const borderStyle: React.CSSProperties = {
    borderLeft: `3px solid ${depth % 2 === 0 ? "var(--accent)" : "var(--border-input)"}`,
    paddingLeft: 12,
    marginLeft: depth === 0 ? 0 : 4,
  };

  return (
    <div style={{ ...borderStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            onRemove={() => removeChild(i)}
          />
        ),
      )}
      <div style={{ display: "flex", gap: 8 }}>
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
  onChange: (next: SmartFilterLeaf) => void;
  onRemove: () => void;
}

const FIELD_OPTIONS = SMART_FILTER_FIELD_DEFS.filter((d) => !d.advanced);

function LeafEditor({ leaf, sectionId, onChange, onRemove }: LeafEditorProps) {
  const ops = withFallbackOp(opsFor(leaf.field), leaf.op);

  const updateField = (field: string) => {
    // Keep the operator only if it still means something for the new field's
    // kind, and drop a value that belonged to the old one.
    const op: SmartFilterOp = opsFor(field).some((o) => o.op === leaf.op) ? leaf.op : "=";
    onChange({ ...leaf, field, op, value: fieldKind(field) === "boolean" ? "1" : "" });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select
        className={shared.input}
        style={{ flex: "0 0 140px" }}
        value={leaf.field}
        onChange={(e) => updateField(e.target.value)}
        aria-label="Field"
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
        {/* Preserve the imported field even if it's outside the curated list, so
            migrated rules with fields like `show.network` round-trip cleanly. */}
        {!FIELD_OPTIONS.some((f) => f.field === leaf.field) && (
          <option value={leaf.field}>{fieldLabel(leaf.field)}</option>
        )}
      </select>
      <select
        className={shared.input}
        style={{ flex: "0 0 140px" }}
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
    </div>
  );
}
