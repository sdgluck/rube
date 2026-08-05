import { useState, useEffect, useImperativeHandle, forwardRef, useMemo, useRef } from "react";
import {
  splitSmartFilterContent,
  restoreSmartFilterContent,
  type SmartFilterEnvelope,
  type SmartFilterGroup,
  type SmartFilterLeaf,
  type SmartFilterNode,
  type SmartFilterOp,
} from "@tinkerbell/plex-smart-filter";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import styles from "./SmartFiltersEditor.module.css";

const SORT_FIELDS = [
  "titleSort",
  "originallyAvailableAt",
  "year",
  "rating",
  "audienceRating",
  "userRating",
  "duration",
  "addedAt",
  "lastViewedAt",
  "mediaHeight",
  "mediaBitrate",
  "viewCount",
];

const TAG_FIELDS = new Set([
  "label",
  "genre",
  "director",
  "actor",
  "writer",
  "studio",
  "country",
  "contentRating",
  "resolution",
  "collection",
]);

const NUMERIC_FIELDS = new Set([
  "year",
  "decade",
  "rating",
  "audienceRating",
  "userRating",
  "duration",
  "originallyAvailableAt",
  "addedAt",
  "lastViewedAt",
  "viewCount",
  "unviewedLeafCount",
]);

const TAG_OPS: { op: SmartFilterOp; label: string }[] = [
  { op: "=", label: "is" },
  { op: "!=", label: "is not" },
];

const NUMERIC_OPS: { op: SmartFilterOp; label: string }[] = [
  { op: "=", label: "=" },
  { op: "!=", label: "≠" },
  { op: ">=", label: "≥" },
  { op: "<=", label: "≤" },
  { op: ">", label: ">" },
  { op: "<", label: "<" },
];

const STRING_OPS: { op: SmartFilterOp; label: string }[] = [
  { op: "=", label: "contains" },
  { op: "==", label: "is" },
  { op: "!=", label: "is not" },
];

const FIELD_LABELS: Record<string, string> = {
  label: "Label",
  genre: "Genre",
  director: "Director",
  actor: "Actor",
  writer: "Writer",
  studio: "Studio",
  country: "Country",
  contentRating: "Content Rating",
  resolution: "Resolution",
  collection: "Collection",
  year: "Year",
  decade: "Decade",
  rating: "Rating",
  audienceRating: "Audience Rating",
  userRating: "User Rating",
  duration: "Duration",
  originallyAvailableAt: "Release Date",
  addedAt: "Date Added",
  lastViewedAt: "Last Played",
  unviewedLeafCount: "Unplayed Episodes",
  viewCount: "Plays",
  titleSort: "Title",
  mediaHeight: "Resolution",
  mediaBitrate: "Bitrate",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

const ALL_KNOWN_FIELDS = [...TAG_FIELDS, ...NUMERIC_FIELDS].sort();

function getOps(field: string): { op: SmartFilterOp; label: string }[] {
  if (NUMERIC_FIELDS.has(field)) return NUMERIC_OPS;
  if (TAG_FIELDS.has(field)) return TAG_OPS;
  return STRING_OPS;
}

function extractSectionId(basePath: string): string | null {
  const m = basePath.match(/\/library\/sections\/(\d+)\//);
  return m ? m[1] : null;
}

// ─── Tree ops ────────────────────────────────────────────────────────────────

function makeLeaf(field = "label", op: SmartFilterOp = "=", value = ""): SmartFilterLeaf {
  return { kind: "leaf", field, op, value };
}

function makeGroup(combinator: "all" | "any" = "all"): SmartFilterGroup {
  return { kind: "group", combinator, children: [makeLeaf()] };
}

function collectFields(node: SmartFilterNode, into: string[] = []): string[] {
  if (node.kind === "leaf") into.push(node.field);
  else for (const c of node.children) collectFields(c, into);
  return into;
}

function isLeaf(n: SmartFilterNode): n is SmartFilterLeaf {
  return n.kind === "leaf";
}

// ─── Row bucketing ───────────────────────────────────────────────────────────
//
// A "bucket" is either a single non-collapsible child rendered as-is,
// or a run of leaves with the same field+op rendered as a multi-value
// chip row. Bucketing is per-parent: leaves with same (field, op) within
// a single parent group collapse together regardless of position.

type Bucket =
  | { kind: "single"; child: SmartFilterNode; index: number }
  | { kind: "multi"; field: string; op: SmartFilterOp; leaves: SmartFilterLeaf[]; indices: number[] };

function bucketChildren(group: SmartFilterGroup): Bucket[] {
  const groups = new Map<string, { leaves: SmartFilterLeaf[]; indices: number[]; firstIdx: number }>();
  for (let i = 0; i < group.children.length; i++) {
    const c = group.children[i];
    if (!isLeaf(c)) continue;
    const key = `${c.field}\u0000${c.op}`;
    const slot = groups.get(key);
    if (slot) {
      slot.leaves.push(c);
      slot.indices.push(i);
    } else {
      groups.set(key, { leaves: [c], indices: [i], firstIdx: i });
    }
  }

  const buckets: Bucket[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < group.children.length; i++) {
    if (consumed.has(i)) continue;
    const c = group.children[i];
    if (isLeaf(c)) {
      const key = `${c.field}\u0000${c.op}`;
      const slot = groups.get(key)!;
      if (slot.leaves.length >= 2) {
        for (const idx of slot.indices) consumed.add(idx);
        buckets.push({ kind: "multi", field: c.field, op: c.op, leaves: slot.leaves, indices: slot.indices });
        continue;
      }
    }
    buckets.push({ kind: "single", child: c, index: i });
  }
  return buckets;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface SmartFiltersEditorHandle {
  save: () => Promise<void>;
  isDirty: boolean;
}

interface Props {
  ratingKey: string;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const SmartFiltersEditor = forwardRef<SmartFiltersEditorHandle, Props>(function SmartFiltersEditor(
  { ratingKey, onSaved, onDirtyChange },
  ref,
) {
  const configQuery = trpc.collections.smartConfig.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const updateMutation = trpc.collections.updateSmartFilters.useMutation();
  const { addToast } = useToast();

  const [envelope, setEnvelope] = useState<SmartFilterEnvelope | null>(null);
  const [filter, setFilter] = useState<SmartFilterGroup | null>(null);
  const [originalUri, setOriginalUri] = useState<string>("");

  useEffect(() => {
    if (configQuery.data?.content) {
      const { envelope, filter } = splitSmartFilterContent(configQuery.data.content);
      setEnvelope(envelope);
      setFilter(filter);
      setOriginalUri(configQuery.data.content);
    }
  }, [configQuery.data]);

  const currentUri = useMemo(() => {
    if (!envelope || !filter) return "";
    return restoreSmartFilterContent(envelope, filter);
  }, [envelope, filter]);

  const isDirty = !!originalUri && currentUri !== "" && currentUri !== originalUri;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useImperativeHandle(
    ref,
    () => ({
      isDirty,
      save: async () => {
        if (!isDirty) return;
        try {
          await updateMutation.mutateAsync({ ratingKey, contentUri: currentUri });
          setOriginalUri(currentUri);
          onSaved?.();
        } catch {
          addToast("Failed to update smart filters", "error");
          throw new Error("save failed");
        }
      },
    }),
    [isDirty, currentUri, ratingKey, updateMutation, onSaved, addToast],
  );

  const sectionId = envelope ? extractSectionId(envelope.basePath) : null;

  if (configQuery.isLoading) return null;
  if (!configQuery.data?.content || !envelope || !filter) return null;

  const allFields = [...new Set([...ALL_KNOWN_FIELDS, ...collectFields(filter)])].sort();

  const sortParts = envelope.sort.split(":");
  const sortField = sortParts[0] || "titleSort";
  const sortDir = sortParts[1] || "asc";
  const sortFieldOptions = SORT_FIELDS.includes(sortField) ? SORT_FIELDS : [...SORT_FIELDS, sortField];

  return (
    <div className={styles.smartSection}>
      <div className={styles.smartToolbar}>
        <span className={styles.smartLabel}>Sort by</span>
        <select
          className={styles.smartSelect}
          value={sortField}
          onChange={(e) => setEnvelope({ ...envelope, sort: `${e.target.value}:${sortDir}` })}
        >
          {sortFieldOptions.map((f) => (
            <option key={f} value={f}>
              {fieldLabel(f)}
            </option>
          ))}
        </select>
        <select
          className={styles.smartSelect}
          value={sortDir}
          onChange={(e) => setEnvelope({ ...envelope, sort: `${sortField}:${e.target.value}` })}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>

      <GroupBody
        group={filter}
        path={[]}
        isRoot
        allFields={allFields}
        sectionId={sectionId}
        onUpdate={(next) => setFilter(next)}
      />
    </div>
  );
});

export default SmartFiltersEditor;

// ─── Group rendering ─────────────────────────────────────────────────────────

interface GroupBodyProps {
  group: SmartFilterGroup;
  path: number[];
  isRoot?: boolean;
  allFields: string[];
  sectionId: string | null;
  onUpdate: (next: SmartFilterGroup) => void;
}

function GroupBody({ group, path, isRoot, allFields, sectionId, onUpdate }: GroupBodyProps) {
  const buckets = useMemo(() => bucketChildren(group), [group]);
  const showCombiner = group.children.length > 1;

  const replaceGroup = (next: SmartFilterGroup) => onUpdate(next);

  const setCombinator = (c: "all" | "any") => replaceGroup({ ...group, combinator: c });

  const setChildAt = (index: number, child: SmartFilterNode | null) => {
    const children = [...group.children];
    if (child === null) children.splice(index, 1);
    else children[index] = child;
    replaceGroup({ ...group, children });
  };

  const replaceMulti = (indices: number[], replacement: SmartFilterLeaf[]) => {
    // Replace the leaves at `indices` with `replacement` leaves, preserving
    // the position of the first occurrence and dropping the rest.
    if (indices.length === 0) return;
    const first = indices[0];
    const drop = new Set(indices.slice(1));
    const children: SmartFilterNode[] = [];
    for (let i = 0; i < group.children.length; i++) {
      if (i === first) children.push(...replacement);
      else if (!drop.has(i)) children.push(group.children[i]);
    }
    replaceGroup({ ...group, children });
  };

  const addLeaf = () => replaceGroup({ ...group, children: [...group.children, makeLeaf()] });
  const addGroup = () => replaceGroup({ ...group, children: [...group.children, makeGroup("any")] });

  return (
    // Depth reads off the rail colour, not indentation alone — three levels of
    // plain indent are indistinguishable once a group has more than two rows.
    <div className={isRoot ? styles.smartRoot : styles.smartGroup} data-depth={Math.min(path.length, 3)}>
      {showCombiner && (
        <div className={styles.smartMatchRow}>
          <span className={styles.smartLabel}>Match</span>
          <select
            className={styles.smartSelect}
            value={group.combinator === "all" ? "all" : "any"}
            onChange={(e) => setCombinator(e.target.value as "all" | "any")}
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          <span className={styles.smartLabel}>of the following</span>
        </div>
      )}

      {buckets.map((bucket, bIdx) => {
        if (bucket.kind === "single") {
          const child = bucket.child;
          const idx = bucket.index;
          if (isLeaf(child)) {
            return (
              <LeafRow
                key={`l-${bIdx}-${idx}`}
                leaf={child}
                allFields={allFields}
                sectionId={sectionId}
                onChange={(next) => setChildAt(idx, next)}
                onRemove={() => setChildAt(idx, null)}
              />
            );
          }
          return (
            <div key={`g-${bIdx}-${idx}`} className={styles.smartNestedGroup}>
              <div className={styles.smartNestedGroupHeader}>
                <button
                  className={styles.smartRemoveBtn}
                  onClick={() => setChildAt(idx, null)}
                  title="Remove group"
                  aria-label="Remove group"
                >
                  ×
                </button>
              </div>
              <GroupBody
                group={child}
                path={[...path, idx]}
                allFields={allFields}
                sectionId={sectionId}
                onUpdate={(next) => setChildAt(idx, next)}
              />
            </div>
          );
        }
        return (
          <MultiValueRow
            key={`m-${bIdx}-${bucket.field}-${bucket.op}`}
            field={bucket.field}
            op={bucket.op}
            values={bucket.leaves.map((l) => l.value)}
            allFields={allFields}
            sectionId={sectionId}
            onChange={(field, op, values) => {
              const replacement = values.map<SmartFilterLeaf>((v) => ({ kind: "leaf", field, op, value: v }));
              replaceMulti(bucket.indices, replacement);
            }}
            onRemove={() => replaceMulti(bucket.indices, [])}
          />
        );
      })}

      <div className={styles.smartActions}>
        <button className={styles.smartLinkBtn} onClick={addLeaf}>
          + Add filter
        </button>
        {isRoot && (
          <button className={styles.smartLinkBtn} onClick={addGroup}>
            + Add group
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Single-leaf row ─────────────────────────────────────────────────────────

function LeafRow({
  leaf,
  allFields,
  sectionId,
  onChange,
  onRemove,
}: {
  leaf: SmartFilterLeaf;
  allFields: string[];
  sectionId: string | null;
  onChange: (next: SmartFilterLeaf) => void;
  onRemove: () => void;
}) {
  const opOptions = withFallbackOp(getOps(leaf.field), leaf.op);
  const isTag = TAG_FIELDS.has(leaf.field);

  const updateField = (field: string) => {
    const oldNumeric = NUMERIC_FIELDS.has(leaf.field);
    const newNumeric = NUMERIC_FIELDS.has(field);
    const op: SmartFilterOp = oldNumeric !== newNumeric ? "=" : leaf.op;
    onChange({ ...leaf, field, op, value: "" });
  };

  return (
    <div className={styles.smartRow}>
      <select className={styles.smartSelect} value={leaf.field} onChange={(e) => updateField(e.target.value)}>
        {allFields.map((f) => (
          <option key={f} value={f}>
            {fieldLabel(f)}
          </option>
        ))}
      </select>
      <select
        className={styles.smartSelect}
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as SmartFilterOp })}
      >
        {opOptions.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {isTag ? (
        <TagValueSelect
          field={leaf.field}
          value={leaf.value}
          sectionId={sectionId}
          onChange={(v) => onChange({ ...leaf, value: v })}
        />
      ) : (
        <input
          type="text"
          className={styles.smartInput}
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        />
      )}
      <button className={styles.smartRemoveBtn} onClick={onRemove} title="Remove" aria-label="Remove filter">
        ×
      </button>
    </div>
  );
}

function withFallbackOp(
  ops: { op: SmartFilterOp; label: string }[],
  current: SmartFilterOp,
): { op: SmartFilterOp; label: string }[] {
  if (ops.some((o) => o.op === current)) return ops;
  return [...ops, { op: current, label: current }];
}

// ─── Multi-value chip row ────────────────────────────────────────────────────

function MultiValueRow({
  field,
  op,
  values,
  allFields,
  sectionId,
  onChange,
  onRemove,
}: {
  field: string;
  op: SmartFilterOp;
  values: string[];
  allFields: string[];
  sectionId: string | null;
  onChange: (field: string, op: SmartFilterOp, values: string[]) => void;
  onRemove: () => void;
}) {
  const opOptions = withFallbackOp(getOps(field), op);
  const isTag = TAG_FIELDS.has(field);

  const fieldQuery = trpc.collections.filterFieldValues.useQuery(
    { sectionId: sectionId!, field },
    { enabled: !!sectionId && isTag, staleTime: 5 * 60_000 },
  );

  const options = fieldQuery.data ?? [];
  const labelFor = (v: string) => options.find((o) => o.key === v)?.title ?? v;

  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState("");

  const updateField = (nextField: string) => {
    const oldNumeric = NUMERIC_FIELDS.has(field);
    const newNumeric = NUMERIC_FIELDS.has(nextField);
    if (oldNumeric !== newNumeric) {
      onChange(nextField, "=", []);
    } else {
      onChange(nextField, op, values);
    }
    setAdding(false);
    setPending("");
  };

  const removeValue = (v: string) => {
    const next = values.filter((x) => x !== v);
    if (next.length === 0) onRemove();
    else onChange(field, op, next);
  };

  const addValue = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || values.includes(trimmed)) {
      setAdding(false);
      setPending("");
      return;
    }
    onChange(field, op, [...values, trimmed]);
    setAdding(false);
    setPending("");
  };

  return (
    <div className={styles.smartRow}>
      <select className={styles.smartSelect} value={field} onChange={(e) => updateField(e.target.value)}>
        {allFields.map((f) => (
          <option key={f} value={f}>
            {fieldLabel(f)}
          </option>
        ))}
      </select>
      <select
        className={styles.smartSelect}
        value={op}
        onChange={(e) => onChange(field, e.target.value as SmartFilterOp, values)}
      >
        {opOptions.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      <div className={styles.smartChipField}>
        {values.map((v) => (
          <span key={v} className={styles.smartChip}>
            {labelFor(v)}
            <button
              type="button"
              className={styles.smartChipRemove}
              onClick={() => removeValue(v)}
              aria-label={`Remove ${labelFor(v)}`}
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          isTag && options.length > 0 ? (
            <select
              autoFocus
              className={styles.smartChipPicker}
              value=""
              onChange={(e) => addValue(e.target.value)}
              onBlur={() => setAdding(false)}
            >
              <option value="" disabled>
                Add…
              </option>
              {options
                .filter((o) => !values.includes(o.key))
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.title}
                  </option>
                ))}
            </select>
          ) : (
            <input
              autoFocus
              type="text"
              className={styles.smartChipPicker}
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onBlur={() => addValue(pending)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addValue(pending);
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setPending("");
                }
              }}
            />
          )
        ) : (
          <button type="button" className={styles.smartChipAdd} onClick={() => setAdding(true)} aria-label="Add value">
            +
          </button>
        )}
      </div>
      <button className={styles.smartRemoveBtn} onClick={onRemove} title="Remove" aria-label="Remove filter">
        ×
      </button>
    </div>
  );
}

// ─── Tag value combobox (single-value variant) ───────────────────────────────

function TagValueSelect({
  field,
  value,
  sectionId,
  onChange,
}: {
  field: string;
  value: string;
  sectionId: string | null;
  onChange: (value: string) => void;
}) {
  const fieldQuery = trpc.collections.filterFieldValues.useQuery(
    { sectionId: sectionId!, field },
    { enabled: !!sectionId && TAG_FIELDS.has(field), staleTime: 5 * 60_000 },
  );

  const options = fieldQuery.data ?? [];

  if (options.length === 0) {
    return <input type="text" className={styles.smartInput} value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <select
      className={`${styles.smartSelect} ${styles.smartSelectGrow}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!options.some((o) => o.key === value) && value && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.title}
        </option>
      ))}
    </select>
  );
}

// ─── Public summary helper ───────────────────────────────────────────────────

export type SmartSummaryCondition =
  | {
      kind: "leaf";
      field: string;
      fieldLabel: string;
      op: SmartFilterOp;
      opLabel: string;
      values: string[];
      isTag: boolean;
    }
  | { kind: "group"; text: string };

export interface SmartSummary {
  sortField: string;
  sortLabel: string;
  sortDir: "asc" | "desc";
  combinator: "all" | "any";
  conditions: SmartSummaryCondition[];
  /** Tag fields referenced by leaf conditions — caller can resolve their
   *  values to human-readable titles via filterFieldValuesBatch. */
  tagFields: string[];
  /** Section ID from the URI's basePath, or null if absent. */
  sectionId: string | null;
}

function opLabel(field: string, op: SmartFilterOp): string {
  return getOps(field).find((o) => o.op === op)?.label ?? op;
}

function summarizeGroup(group: SmartFilterGroup, isRoot: boolean): SmartSummaryCondition[] {
  const buckets = bucketChildren(group);
  const out: SmartSummaryCondition[] = [];
  for (const b of buckets) {
    if (b.kind === "single") {
      const c = b.child;
      if (c.kind === "leaf") {
        out.push({
          kind: "leaf",
          field: c.field,
          fieldLabel: fieldLabel(c.field),
          op: c.op,
          opLabel: opLabel(c.field, c.op),
          values: [c.value],
          isTag: TAG_FIELDS.has(c.field),
        });
      } else {
        const inner = summarizeGroup(c, false);
        // If a nested group reduces to a single leaf condition (the
        // common case: an OR-group of same-field same-op leaves like
        // `Genre is X OR Y OR Z`), lift it so tag resolution still
        // applies. Only fall back to text-form for genuinely complex
        // nested expressions.
        if (inner.length === 1 && inner[0].kind === "leaf") {
          out.push(inner[0]);
        } else {
          const text = inner.map(conditionText).join(c.combinator === "all" ? " AND " : " OR ");
          out.push({ kind: "group", text: isRoot ? text : `(${text})` });
        }
      }
    } else {
      out.push({
        kind: "leaf",
        field: b.field,
        fieldLabel: fieldLabel(b.field),
        op: b.op,
        opLabel: opLabel(b.field, b.op),
        values: b.leaves.map((l) => l.value),
        isTag: TAG_FIELDS.has(b.field),
      });
    }
  }
  return out;
}

function conditionText(c: SmartSummaryCondition): string {
  if (c.kind === "group") return c.text;
  const vals = c.values.map((v) => v || "?").join(", ");
  return `${c.fieldLabel} ${c.opLabel} ${vals}`;
}

export function summarizeSmartContent(content: string): SmartSummary | null {
  if (!content) return null;
  const { envelope, filter } = splitSmartFilterContent(content);
  if (!envelope.machineId) return null;
  const [sortFieldRaw, sortDirRaw] = envelope.sort.split(":");
  const sortField = sortFieldRaw || "titleSort";
  const sortDir: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";
  const conditions = summarizeGroup(filter, true);
  const tagFields = [...new Set(conditions.flatMap((c) => (c.kind === "leaf" && c.isTag ? [c.field] : [])))];
  return {
    sortField,
    sortLabel: fieldLabel(sortField),
    sortDir,
    combinator: filter.combinator,
    conditions,
    tagFields,
    sectionId: extractSectionId(envelope.basePath),
  };
}

// ─── Value formatting ───────────────────────────────────────────────────────

const DATE_FIELDS = new Set(["originallyAvailableAt", "addedAt", "lastViewedAt"]);
const DURATION_FIELDS = new Set(["duration"]);

/** Plex relative date offset: -7d, -2w, -3mon, -20y. */
const RELATIVE_DATE = /^-(\d+)(d|w|mon|y)$/;

function formatRelativeDate(value: string): string | null {
  const m = value.match(RELATIVE_DATE);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const d = new Date();
  if (unit === "d") d.setDate(d.getDate() - n);
  else if (unit === "w") d.setDate(d.getDate() - n * 7);
  else if (unit === "mon") d.setMonth(d.getMonth() - n);
  else d.setFullYear(d.getFullYear() - n);
  return unit === "y" ? String(d.getFullYear()) : d.toISOString().slice(0, 10);
}

function formatDuration(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return value;
  const totalMinutes = Math.round(n / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Format a non-tag filter value (tag values resolve via the network). */
function formatScalarValue(field: string, value: string): string {
  if (!value) return "?";
  if (DATE_FIELDS.has(field)) {
    return formatRelativeDate(value) ?? value;
  }
  if (DURATION_FIELDS.has(field)) {
    return formatDuration(value);
  }
  return value;
}

// ─── Summary component ──────────────────────────────────────────────────────

interface SummaryProps {
  content: string;
  maxChips?: number;
  onEdit?: () => void;
}

export function SmartFilterSummary({ content, maxChips = 4, onEdit }: SummaryProps) {
  const summary = useMemo(() => summarizeSmartContent(content), [content]);

  if (!summary) return null;

  const visible = summary.conditions.slice(0, maxChips);
  const overflow = summary.conditions.length - visible.length;

  return (
    <div className={styles.smartSummary}>
      <span className={styles.smartSummaryLabel}>Filters</span>
      <span className={`${styles.smartSummaryChip} ${styles.smartSummarySort}`} title="Sort">
        {summary.sortLabel} {summary.sortDir === "desc" ? "↓" : "↑"}
      </span>
      {summary.conditions.length === 0 ? (
        <span className={styles.smartSummaryChip}>No conditions</span>
      ) : (
        visible.map((c, i) => <ConditionChip key={i} condition={c} sectionId={summary.sectionId} />)
      )}
      {overflow > 0 && <span className={styles.smartSummaryChip}>+{overflow} more</span>}
      {onEdit && (
        <>
          <span className={styles.smartSummarySpacer} />
          <button className={styles.smartSummaryEdit} onClick={onEdit}>
            Edit filters
          </button>
        </>
      )}
    </div>
  );
}

function ConditionChip({ condition, sectionId }: { condition: SmartSummaryCondition; sectionId: string | null }) {
  // Hook called unconditionally; gated by `enabled`. Same query key as
  // MultiValueRow uses, so tRPC dedupes the request.
  const tagField = condition.kind === "leaf" && condition.isTag ? condition.field : "";
  const valuesQuery = trpc.collections.filterFieldValues.useQuery(
    { sectionId: sectionId ?? "", field: tagField },
    { enabled: !!sectionId && !!tagField, staleTime: 5 * 60_000 },
  );

  let text: string;
  if (condition.kind === "group") {
    text = condition.text;
  } else if (condition.isTag) {
    const opts = valuesQuery.data ?? [];
    const vals = condition.values.map((v) => opts.find((o) => o.key === v)?.title ?? v ?? "?").join(", ");
    text = `${condition.fieldLabel} ${condition.opLabel} ${vals}`;
  } else {
    const vals = condition.values.map((v) => formatScalarValue(condition.field, v)).join(", ");
    text = `${condition.fieldLabel} ${condition.opLabel} ${vals}`;
  }

  return (
    <span className={styles.smartSummaryChip} title={text}>
      {text}
    </span>
  );
}

// ─── Drawer wrapper ──────────────────────────────────────────────────────────

interface DrawerProps {
  open: boolean;
  ratingKey: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function SmartFiltersDrawer({ open, ratingKey, onClose, onSaved }: DrawerProps) {
  const [exiting, setExiting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<SmartFiltersEditorHandle | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setDirty(false);
      onClose();
    }, 180);
  };

  const handleApply = async () => {
    if (!dirty || !editorRef.current) {
      handleClose();
      return;
    }
    setSaving(true);
    try {
      await editorRef.current.save();
      onSaved?.();
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className={`${styles.drawerBackdrop} ${exiting ? styles.drawerBackdropExiting : ""}`} onClick={handleClose}>
      <div
        className={`${styles.drawerPanel} ${exiting ? styles.drawerPanelExiting : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit smart filters"
      >
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>Edit smart filters</div>
          <button className={styles.drawerClose} onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.drawerBody}>
          <SmartFiltersEditor ref={editorRef} ratingKey={ratingKey} onDirtyChange={setDirty} />
        </div>
        <div className={styles.drawerFooter}>
          <button className={shared.buttonSecondary} onClick={handleClose} disabled={saving}>
            Cancel
          </button>
          <button className={shared.button} onClick={handleApply} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
