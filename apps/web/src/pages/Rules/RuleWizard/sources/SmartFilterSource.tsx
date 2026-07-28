import shared from "#pages/Collections.module.css";
import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import { SMART_FILTER_FIELDS, SMART_FILTER_OPS } from "#pages/Rules/RuleWizard/constants.ts";
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
export default function SmartFilterSource({ form, setForm }: SourceStepProps) {
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
        <GroupEditor group={form.smartFilter} onChange={setRoot} depth={0} />
      </div>
    </>
  );
}

interface GroupEditorProps {
  group: SmartFilterGroup;
  onChange: (next: SmartFilterGroup) => void;
  /** 0 = root. Root group can't be removed; subgroups can. */
  depth: number;
  onRemove?: () => void;
}

function GroupEditor({ group, onChange, depth, onRemove }: GroupEditorProps) {
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
          <LeafEditor key={i} leaf={child} onChange={(next) => updateChild(i, next)} onRemove={() => removeChild(i)} />
        ) : (
          <GroupEditor
            key={i}
            group={child}
            onChange={(next) => updateChild(i, next)}
            depth={depth + 1}
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
  onChange: (next: SmartFilterLeaf) => void;
  onRemove: () => void;
}

function LeafEditor({ leaf, onChange, onRemove }: LeafEditorProps) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select
        className={shared.input}
        style={{ flex: "0 0 140px" }}
        value={leaf.field}
        onChange={(e) => onChange({ ...leaf, field: e.target.value })}
        aria-label="Field"
      >
        {SMART_FILTER_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
        {/* Preserve the imported field even if it's outside the curated list, so
            migrated rules with fields like `show.network` round-trip cleanly. */}
        {!SMART_FILTER_FIELDS.some((f) => f.value === leaf.field) && <option value={leaf.field}>{leaf.field}</option>}
      </select>
      <select
        className={shared.input}
        style={{ flex: "0 0 110px" }}
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as SmartFilterOp })}
        aria-label="Operator"
      >
        {SMART_FILTER_OPS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <input
        className={shared.input}
        style={{ flex: 1 }}
        value={leaf.value}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        placeholder="Value"
        aria-label="Value"
      />
      <button type="button" className={styles.summaryEdit} onClick={onRemove} aria-label="Remove clause">
        Remove
      </button>
    </div>
  );
}
