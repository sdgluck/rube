import { useState, useEffect, useCallback } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import styles from "#pages/Collections.module.css";

const SYSTEM_PARAMS = new Set(["type", "sort", "limit", "includeGuids"]);

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

const TAG_OPERATORS = [
  { value: "", label: "is" },
  { value: "!", label: "is not" },
];

const NUMERIC_OPERATORS = [
  { value: "", label: "=" },
  { value: "!", label: "!=" },
  { value: ">>", label: ">=" },
  { value: "<<", label: "<=" },
  { value: ">>>", label: ">" },
  { value: "<<<", label: "<" },
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
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

const ALL_KNOWN_FIELDS = [...TAG_FIELDS, ...NUMERIC_FIELDS].sort();

// ─── Data model ──────────────────────────────────────────────────────────────

interface FilterRule {
  kind: "rule";
  field: string;
  operator: string;
  value: string;
}

interface FilterGroup {
  kind: "group";
  combiner: "and" | "or";
  items: FilterItem[];
}

type FilterItem = FilterRule | FilterGroup;

interface ParsedContent {
  machineId: string;
  basePath: string;
  type: string;
  sort: string;
  root: FilterGroup;
}

// ─── Operator encoding ──────────────────────────────────────────────────────

function parseOperatorFromKey(key: string): { field: string; operator: string } {
  if (key.endsWith(">>>=")) return { field: key.slice(0, -4), operator: ">>>" };
  if (key.endsWith("<<<=")) return { field: key.slice(0, -4), operator: "<<<" };
  if (key.endsWith(">>=")) return { field: key.slice(0, -3), operator: ">>" };
  if (key.endsWith("<<=")) return { field: key.slice(0, -3), operator: "<<" };
  if (key.endsWith("!=")) return { field: key.slice(0, -2), operator: "!" };
  return { field: key, operator: "" };
}

function encodeOperatorToKey(field: string, operator: string): string {
  switch (operator) {
    case "!":
      return `${field}!=`;
    case ">>":
      return `${field}>>=`;
    case "<<":
      return `${field}<<=`;
    case ">>>":
      return `${field}>>>=`;
    case "<<<":
      return `${field}<<<=`;
    default:
      return field;
  }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseContentUri(content: string): ParsedContent {
  const result: ParsedContent = {
    machineId: "",
    basePath: "",
    type: "",
    sort: "",
    root: { kind: "group", combiner: "and", items: [] },
  };

  if (!content) return result;

  const serverMatch = content.match(/^server:\/\/([^/]+)\/com\.plexapp\.plugins\.library(.+)$/);
  if (!serverMatch) return result;

  result.machineId = serverMatch[1];
  const rest = serverMatch[2];

  const qIndex = rest.indexOf("?");
  if (qIndex === -1) {
    result.basePath = rest;
    return result;
  }

  result.basePath = rest.substring(0, qIndex);
  const queryString = rest.substring(qIndex + 1);
  const params = new URLSearchParams(queryString);

  // Collect all entries in order (URLSearchParams preserves insertion order)
  const entries: [string, string][] = [];
  for (const entry of params.entries()) entries.push(entry);

  // Check if there are any push/pop params
  const hasGrouping = entries.some(([k]) => k === "push" || k === "pop");

  if (!hasGrouping) {
    // Simple flat filters — all implicitly ANDed
    for (const [rawKey, value] of entries) {
      if (rawKey === "type") {
        result.type = value;
        continue;
      }
      if (rawKey === "sort") {
        result.sort = value;
        continue;
      }
      if (SYSTEM_PARAMS.has(rawKey)) continue;
      const { field, operator } = parseOperatorFromKey(rawKey);
      result.root.items.push({ kind: "rule", field, operator, value });
    }
    return result;
  }

  // Stack-based parsing for grouped filters
  // push=1 opens a group, pop=1 closes it, and=1/or=1 between siblings sets combiner
  const stack: FilterGroup[] = [];

  for (const [rawKey, value] of entries) {
    if (rawKey === "type") {
      result.type = value;
      continue;
    }
    if (rawKey === "sort") {
      result.sort = value;
      continue;
    }
    if (SYSTEM_PARAMS.has(rawKey)) continue;

    if (rawKey === "push") {
      stack.push({ kind: "group", combiner: "and", items: [] });
      continue;
    }

    if (rawKey === "pop") {
      const completed = stack.pop();
      if (!completed) continue;
      if (stack.length === 0) {
        // This is the outermost group — becomes our root
        result.root = completed;
      } else {
        // Add as child of parent group
        stack[stack.length - 1].items.push(completed);
      }
      continue;
    }

    if (rawKey === "and" || rawKey === "or") {
      if (stack.length > 0) {
        stack[stack.length - 1].combiner = rawKey;
      }
      continue;
    }

    // Regular filter param
    const { field, operator } = parseOperatorFromKey(rawKey);
    const rule: FilterRule = { kind: "rule", field, operator, value };
    if (stack.length > 0) {
      stack[stack.length - 1].items.push(rule);
    } else {
      result.root.items.push(rule);
    }
  }

  // If any groups left on stack (malformed), attach them
  while (stack.length > 0) {
    const g = stack.pop()!;
    if (stack.length > 0) {
      stack[stack.length - 1].items.push(g);
    } else {
      result.root = g;
    }
  }

  return result;
}

// ─── Building ────────────────────────────────────────────────────────────────

function buildContentUri(parsed: ParsedContent): string {
  const parts: string[] = [];
  if (parsed.type) parts.push(`type=${encodeURIComponent(parsed.type)}`);
  if (parsed.sort) parts.push(`sort=${encodeURIComponent(parsed.sort)}`);

  const isSimple = parsed.root.items.every((item) => item.kind === "rule");

  if (isSimple) {
    // Flat params, no push/pop needed
    for (const item of parsed.root.items) {
      const rule = item as FilterRule;
      const key = encodeOperatorToKey(rule.field, rule.operator);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(rule.value)}`);
    }
  } else {
    // Grouped: emit push/pop structure
    serializeGroup(parsed.root, parts);
  }

  return `server://${parsed.machineId}/com.plexapp.plugins.library${parsed.basePath}?${parts.join("&")}`;
}

function serializeGroup(group: FilterGroup, parts: string[]): void {
  parts.push("push=1");
  for (let i = 0; i < group.items.length; i++) {
    const item = group.items[i];
    if (item.kind === "rule") {
      const key = encodeOperatorToKey(item.field, item.operator);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item.value)}`);
    } else {
      serializeGroup(item, parts);
    }
    // Emit combiner between siblings (not after the last one)
    if (i < group.items.length - 1) {
      parts.push(`${group.combiner}=1`);
    }
  }
  parts.push("pop=1");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOperatorsForField(field: string): { value: string; label: string }[] {
  if (NUMERIC_FIELDS.has(field)) return NUMERIC_OPERATORS;
  return TAG_OPERATORS;
}

function collectFields(items: FilterItem[]): string[] {
  const fields: string[] = [];
  for (const item of items) {
    if (item.kind === "rule") {
      fields.push(item.field);
    } else {
      fields.push(...collectFields(item.items));
    }
  }
  return fields;
}

function makeRule(field = "label", operator = "", value = ""): FilterRule {
  return { kind: "rule", field, operator, value };
}

function makeGroup(combiner: "and" | "or" = "and"): FilterGroup {
  return { kind: "group", combiner, items: [makeRule()] };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SmartFiltersEditorProps {
  ratingKey: string;
  onSave?: () => void;
}

function extractSectionId(basePath: string): string | null {
  const match = basePath.match(/\/library\/sections\/(\d+)\//);
  return match ? match[1] : null;
}

export default function SmartFiltersEditor({ ratingKey, onSave }: SmartFiltersEditorProps) {
  const configQuery = trpc.collections.smartConfig.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const updateMutation = trpc.collections.updateSmartFilters.useMutation();

  const [parsed, setParsed] = useState<ParsedContent | null>(null);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (configQuery.data?.content) {
      setParsed(parseContentUri(configQuery.data.content));
    }
  }, [configQuery.data]);

  const updateRoot = useCallback((updater: (root: FilterGroup) => FilterGroup) => {
    setParsed((prev) => (prev ? { ...prev, root: updater(prev.root) } : prev));
  }, []);

  const sectionId = parsed ? extractSectionId(parsed.basePath) : null;

  if (configQuery.isLoading) return null;
  if (!configQuery.data?.content || !parsed) return null;

  const allFields = [...new Set([...ALL_KNOWN_FIELDS, ...collectFields(parsed.root.items)])].sort();

  const sortParts = parsed.sort.split(":");
  const sortField = sortParts[0] || "titleSort";
  const sortDir = sortParts[1] || "asc";

  const hasSubGroups = parsed.root.items.some((item) => item.kind === "group");

  const handleSave = async () => {
    setSaving(true);
    try {
      const contentUri = buildContentUri(parsed);
      await updateMutation.mutateAsync({ ratingKey, contentUri });
      addToast("Smart filters updated", "success");
      onSave?.();
    } catch {
      addToast("Failed to update smart filters", "error");
    } finally {
      setSaving(false);
    }
  };

  const addRuleToRoot = () => {
    updateRoot((root) => ({ ...root, items: [...root.items, makeRule()] }));
  };

  const addGroupToRoot = () => {
    updateRoot((root) => ({ ...root, items: [...root.items, makeGroup()] }));
  };

  const updateRootItem = (index: number, item: FilterItem) => {
    updateRoot((root) => {
      const items = [...root.items];
      items[index] = item;
      return { ...root, items };
    });
  };

  const removeRootItem = (index: number) => {
    updateRoot((root) => ({
      ...root,
      items: root.items.filter((_, i) => i !== index),
    }));
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>Smart Filters</legend>

      <div className={styles.sortRow}>
        <span className={styles.fieldLabel}>Sort</span>
        <select
          className={styles.filterSelect}
          value={sortField}
          onChange={(e) => setParsed({ ...parsed, sort: `${e.target.value}:${sortDir}` })}
        >
          {[
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
          ].map((f) => (
            <option key={f} value={f}>
              {fieldLabel(f)}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={sortDir}
          onChange={(e) => setParsed({ ...parsed, sort: `${sortField}:${e.target.value}` })}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>

      {(hasSubGroups || parsed.root.items.length > 1) && (
        <div className={styles.combinerRow}>
          <span className={styles.combinerLabel}>Match</span>
          <select
            className={styles.filterSelect}
            value={parsed.root.combiner}
            onChange={(e) => updateRoot((root) => ({ ...root, combiner: e.target.value as "and" | "or" }))}
          >
            <option value="and">all</option>
            <option value="or">any</option>
          </select>
          <span className={styles.combinerLabel}>of the following</span>
        </div>
      )}

      {parsed.root.items.map((item, i) => (
        <div key={i}>
          {item.kind === "rule" ? (
            <RuleRow
              rule={item}
              allFields={allFields}
              sectionId={sectionId}
              onChange={(updated) => updateRootItem(i, updated)}
              onRemove={() => removeRootItem(i)}
            />
          ) : (
            <GroupBox
              group={item}
              allFields={allFields}
              sectionId={sectionId}
              onChange={(updated) => updateRootItem(i, updated)}
              onRemove={() => removeRootItem(i)}
            />
          )}
          {i < parsed.root.items.length - 1 && hasSubGroups && (
            <div className={styles.combinerDivider}>
              <span className={styles.combinerDividerText}>{parsed.root.combiner === "and" ? "AND" : "OR"}</span>
            </div>
          )}
        </div>
      ))}

      <div className={styles.filterActions}>
        <button className={styles.filterAddBtn} onClick={addRuleToRoot}>
          + Add filter
        </button>
        <button className={styles.filterAddBtn} onClick={addGroupToRoot}>
          + Add group
        </button>
      </div>

      <div className={styles.buttons} style={{ justifyContent: "flex-end" }}>
        <button className={styles.button} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Filters"}
        </button>
      </div>
    </fieldset>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

  const options = fieldQuery.data || [];

  if (options.length === 0) {
    return (
      <input type="text" className={styles.filterInput} value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }

  return (
    <select
      className={styles.filterSelect}
      style={{ flex: 1 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!options.some((o) => o.key === value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.title}
        </option>
      ))}
    </select>
  );
}

function RuleRow({
  rule,
  allFields,
  sectionId,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  allFields: string[];
  sectionId: string | null;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
}) {
  const operators = getOperatorsForField(rule.field);
  const isTag = TAG_FIELDS.has(rule.field);

  const updateField = (field: string) => {
    const oldIsNumeric = NUMERIC_FIELDS.has(rule.field);
    const newIsNumeric = NUMERIC_FIELDS.has(field);
    const operator = oldIsNumeric !== newIsNumeric ? "" : rule.operator;
    onChange({ ...rule, field, operator, value: "" });
  };

  return (
    <div className={styles.filterRow}>
      <select className={styles.filterSelect} value={rule.field} onChange={(e) => updateField(e.target.value)}>
        {allFields.map((f) => (
          <option key={f} value={f}>
            {fieldLabel(f)}
          </option>
        ))}
      </select>
      <select
        className={styles.filterSelect}
        value={rule.operator}
        onChange={(e) => onChange({ ...rule, operator: e.target.value })}
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {isTag ? (
        <TagValueSelect
          field={rule.field}
          value={rule.value}
          sectionId={sectionId}
          onChange={(value) => onChange({ ...rule, value })}
        />
      ) : (
        <input
          type="text"
          className={styles.filterInput}
          value={rule.value}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      )}
      <button className={styles.filterRemoveBtn} onClick={onRemove} title="Remove filter">
        &times;
      </button>
    </div>
  );
}

function GroupBox({
  group,
  allFields,
  sectionId,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  allFields: string[];
  sectionId: string | null;
  onChange: (group: FilterGroup) => void;
  onRemove: () => void;
}) {
  const updateItem = (index: number, item: FilterItem) => {
    const items = [...group.items];
    items[index] = item;
    onChange({ ...group, items });
  };

  const removeItem = (index: number) => {
    onChange({ ...group, items: group.items.filter((_, i) => i !== index) });
  };

  const addRule = () => {
    onChange({ ...group, items: [...group.items, makeRule()] });
  };

  return (
    <div className={styles.filterGroupBox}>
      <div className={styles.filterGroupHeader}>
        <span className={styles.combinerLabel}>Match</span>
        <select
          className={styles.filterSelect}
          value={group.combiner}
          onChange={(e) => onChange({ ...group, combiner: e.target.value as "and" | "or" })}
        >
          <option value="and">all</option>
          <option value="or">any</option>
        </select>
        <span className={styles.combinerLabel}>of the following</span>
        <div style={{ flex: 1 }} />
        <button className={styles.filterRemoveBtn} onClick={onRemove} title="Remove group">
          &times;
        </button>
      </div>
      {group.items.map((item, i) =>
        item.kind === "rule" ? (
          <RuleRow
            key={i}
            rule={item}
            allFields={allFields}
            sectionId={sectionId}
            onChange={(updated) => updateItem(i, updated)}
            onRemove={() => removeItem(i)}
          />
        ) : null,
      )}
      <button className={styles.filterAddBtn} onClick={addRule}>
        + Add filter
      </button>
    </div>
  );
}
