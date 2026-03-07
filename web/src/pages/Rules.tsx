import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import DropdownButton from "../DropdownButton";
import ConfirmModal from "../ConfirmModal";
import shared from "./Collections.module.css";
import styles from "./Rules.module.css";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const RULE_TYPES = [
  { value: "ai_prompt", label: "AI Prompt" },
  { value: "top_rated", label: "Top Rated" },
  { value: "lowest_rated", label: "Lowest Rated" },
  { value: "actors", label: "Actors" },
  { value: "studios", label: "Studios" },
  { value: "imdb_chart", label: "IMDb Chart" },
  { value: "imdb_list", label: "IMDb List" },
  { value: "rt_top_rated", label: "RT Top Rated" },
  { value: "seerr_requests", label: "Seerr Requests" },
];

const IMDB_CHARTS = [
  { value: "top_250_movies", label: "Top 250 Movies" },
  { value: "top_250_tv", label: "Top 250 TV Shows" },
  { value: "popular_movies", label: "Most Popular Movies" },
  { value: "popular_tv", label: "Most Popular TV Shows" },
  { value: "box_office", label: "Box Office" },
];

const IMDB_CHART_LABELS: Record<string, string> = Object.fromEntries(IMDB_CHARTS.map((c) => [c.value, c.label]));

// Charts that target a specific Plex section type
const IMDB_CHART_SECTION_TYPE: Record<string, string> = {
  top_250_movies: "movie",
  top_250_tv: "show",
  popular_movies: "movie",
  popular_tv: "show",
  box_office: "movie",
};

const SEERR_FILTERS = [
  { value: "all", label: "All Requests" },
  { value: "approved", label: "Approved" },
  { value: "available", label: "Available" },
  { value: "pending", label: "Pending" },
];

const SEERR_FILTER_LABELS: Record<string, string> = Object.fromEntries(SEERR_FILTERS.map((f) => [f.value, f.label]));

const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));

const CONFIG_SUMMARY: Record<string, (c: Record<string, unknown>) => string> = {
  ai_prompt: (c) => `Limit: ${c.limit ?? 8} | Min items: ${c.minItems ?? 15}`,
  top_rated: (c) => `${c.limit ?? 50} items`,
  lowest_rated: (c) => `${c.limit ?? 50} items`,
  imdb_chart: (c) => IMDB_CHART_LABELS[c.chart as string] || (c.chart as string) || "—",
  imdb_list: (c) => (c.listId as string) || "—",
  rt_top_rated: (c) => `Top ${c.limit ?? 100} items`,
  seerr_requests: (c) => `${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"} | ${c.limit ?? 50} items`,
};

const TYPE_BADGE: Record<string, string> = {
  ai_prompt: styles.typeAi,
  imdb_chart: styles.typeImdb,
  imdb_list: styles.typeImdb,
  rt_top_rated: styles.typeRt,
  seerr_requests: styles.typeSeerr,
};

interface FormState {
  id?: string;
  name: string;
  type: string;
  prompt: string;
  limit: number;
  minItems: number;
  sections: string[];
  chart: string;
  listId: string;
  filter: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "ai_prompt",
  prompt: "",
  limit: 8,
  minItems: 15,
  sections: [],
  chart: "top_250_movies",
  listId: "",
  filter: "all",
};

function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  return 10;
}

function maxLimitForType(type: string): number {
  if (type === "ai_prompt") return 10;
  if (type === "top_rated" || type === "lowest_rated") return 200;
  if (type === "rt_top_rated") return 200;
  if (type === "seerr_requests") return 200;
  return 50;
}

function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list";
}

export default function Rules() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const rulesQuery = trpc.rules.list.useQuery();
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const createMutation = trpc.rules.create.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const updateMutation = trpc.rules.update.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const deleteMutation = trpc.rules.delete.useMutation({ onSuccess: () => utils.rules.list.invalidate() });

  const testMutation = trpc.rules.test.useMutation();
  const cancelTestMutation = trpc.rules.cancelTest.useMutation();
  const testingRuleIdRef = useRef<string | null>(null);

  const runMutation = trpc.rules.run.useMutation({
    onSuccess: () => utils.rules.list.invalidate(),
  });
  const cancelRunMutation = trpc.rules.cancelRun.useMutation();
  const runningRuleIdRef = useRef<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastClickedIndex = useRef<number | null>(null);

  const rules = rulesQuery.data || [];
  const sections = sectionsQuery.data || [];

  function getExportData() {
    return rules.map((r) => {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(r.config || "{}");
      } catch {}
      return { name: r.name, type: r.type, enabled: !!r.enabled, config };
    });
  }

  function handleExportFile() {
    downloadJson(getExportData(), "tinkerbell-rules.json");
  }

  async function handleExportClipboard() {
    await navigator.clipboard.writeText(JSON.stringify(getExportData(), null, 2));
    setImportStatus({ type: "success", message: "Copied rules to clipboard" });
  }

  async function importRules(text: string) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Expected an array of rules");
    let count = 0;
    for (const rule of data) {
      await createMutation.mutateAsync({
        name: rule.name,
        type: rule.type,
        config: JSON.stringify(rule.config || {}),
      });
      if (rule.enabled === false) {
        const latest = utils.rules.list.getData();
        const created = latest?.find((r) => r.name === rule.name && r.type === rule.type);
        if (created) {
          await updateMutation.mutateAsync({ id: created.id, enabled: false });
        }
      }
      count++;
    }
    utils.rules.list.invalidate();
    setImportStatus({ type: "success", message: `Imported ${count} rule${count !== 1 ? "s" : ""}` });
  }

  async function handleImportFile(file: File) {
    try {
      await importRules(await file.text());
    } catch (err) {
      setImportStatus({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImportClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await importRules(text);
    } catch (err) {
      setImportStatus({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  }

  function startCreate() {
    setForm({ ...EMPTY_FORM });
    setIsEditing(false);
  }

  function startEdit(rule: (typeof rules)[0]) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(rule.config || "{}");
    } catch {}
    setForm({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      prompt: (config.prompt as string) || "",
      limit: (config.limit as number) ?? defaultLimitForType(rule.type),
      minItems: (config.minItems as number) ?? 15,
      sections: (config.sections as string[]) || [],
      chart: (config.chart as string) || "top_250_movies",
      listId: (config.listId as string) || "",
      filter: (config.filter as string) || "all",
    });
    setIsEditing(true);
  }

  function cancelForm() {
    setForm(null);
    setIsEditing(false);
  }

  function handleSave() {
    if (!form) return;
    const config: Record<string, unknown> = {};
    if (typeHasLimit(form.type)) config.limit = form.limit;
    if (form.type === "ai_prompt") {
      config.prompt = form.prompt;
      config.minItems = form.minItems;
    }
    if (form.type === "imdb_chart") config.chart = form.chart;
    if (form.type === "imdb_list") config.listId = form.listId;
    if (form.type === "seerr_requests") config.filter = form.filter;
    if (form.sections.length > 0) config.sections = form.sections;
    const configStr = JSON.stringify(config);

    if (isEditing && form.id) {
      updateMutation.mutate({ id: form.id, name: form.name, config: configStr }, { onSuccess: () => cancelForm() });
    } else {
      createMutation.mutate({ name: form.name, type: form.type, config: configStr }, { onSuccess: () => cancelForm() });
    }
  }

  function handleToggle(rule: (typeof rules)[0]) {
    updateMutation.mutate({ id: rule.id, enabled: !rule.enabled });
  }

  function handleDelete(rule: (typeof rules)[0]) {
    setPendingConfirm({
      message: `Delete rule "${rule.name}"?`,
      onConfirm: () => {
        deleteMutation.mutate({ id: rule.id });
        setPendingConfirm(null);
      },
    });
  }

  function handleCheckboxClick(index: number, e: React.MouseEvent) {
    const id = rules[index].id;

    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          next.add(rules[i].id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    lastClickedIndex.current = index;
  }

  function toggleSelectAll() {
    if (selected.size === rules.length) setSelected(new Set());
    else setSelected(new Set(rules.map((r) => r.id)));
  }

  function handleBulkDelete() {
    const count = selected.size;
    setPendingConfirm({
      message: `Delete ${count} rule${count !== 1 ? "s" : ""}?`,
      onConfirm: async () => {
        setPendingConfirm(null);
        for (const id of selected) {
          await deleteMutation.mutateAsync({ id });
        }
        setSelected(new Set());
        utils.rules.list.invalidate();
      },
    });
  }

  function handleTest(rule: (typeof rules)[0]) {
    setTestingRuleId(rule.id);
    testingRuleIdRef.current = rule.id;
    testMutation.mutate({ id: rule.id });
  }

  function handleCancelTest() {
    if (testingRuleId) {
      cancelTestMutation.mutate({ id: testingRuleId });
    }
    testingRuleIdRef.current = null;
    setTestingRuleId(null);
    testMutation.reset();
  }

  function closeTestPreview() {
    testingRuleIdRef.current = null;
    setTestingRuleId(null);
    testMutation.reset();
  }

  function handleRun(rule: (typeof rules)[0]) {
    setRunningRuleId(rule.id);
    runningRuleIdRef.current = rule.id;
    runMutation.mutate(
      { id: rule.id },
      {
        onSettled: () => {
          runningRuleIdRef.current = null;
          setRunningRuleId(null);
        },
      },
    );
  }

  function handleCancelRun() {
    if (runningRuleId) {
      cancelRunMutation.mutate({ id: runningRuleId });
    }
    runningRuleIdRef.current = null;
    setRunningRuleId(null);
    runMutation.reset();
  }

  // Cancel test/run on unmount (e.g. navigation away)
  useEffect(() => {
    return () => {
      if (testingRuleIdRef.current) {
        cancelTestMutation.mutate({ id: testingRuleIdRef.current });
      }
      if (runningRuleIdRef.current) {
        cancelRunMutation.mutate({ id: runningRuleIdRef.current });
      }
    };
  }, []);

  // When switching type in create mode, reset limit to default
  useEffect(() => {
    if (form && !isEditing) {
      setForm((prev) => (prev ? { ...prev, limit: defaultLimitForType(prev.type) } : prev));
    }
  }, [form?.type]);

  // Auto-select sections for type-specific IMDB charts
  const chartSectionType = form?.type === "imdb_chart" ? IMDB_CHART_SECTION_TYPE[form.chart] : undefined;
  const sectionsLocked = !!chartSectionType;

  useEffect(() => {
    if (form?.type === "imdb_chart" && chartSectionType && sections.length > 0) {
      const locked = sections.filter((s) => s.type === chartSectionType).map((s) => s.title);
      setForm((prev) => (prev ? { ...prev, sections: locked } : prev));
    }
  }, [form?.type, form?.chart, chartSectionType, sections]);

  if (rulesQuery.isLoading) return <p>Loading...</p>;

  return (
    <div>
      <div className={shared.header}>
        <h2 className={shared.heading}>
          Rules{rules.length > 0 && <span className="count-badge">{rules.length}</span>}
        </h2>
        <div className={shared.headerActions}>
          <DropdownButton
            label="Export"
            className={shared.buttonSecondary}
            disabled={rules.length === 0}
            options={[
              { label: "File", onClick: handleExportFile },
              { label: "Clipboard", onClick: handleExportClipboard },
            ]}
          />
          <DropdownButton
            label="Import"
            className={shared.buttonSecondary}
            options={[
              { label: "File", onClick: () => fileInputRef.current?.click() },
              { label: "Clipboard", onClick: handleImportClipboard },
            ]}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
          />
          <button className={shared.button} onClick={startCreate} disabled={!!form}>
            Add Rule
          </button>
        </div>
      </div>
      <p className={styles.description}>
        Rules define how the Generate Collections job creates collections. Each enabled rule runs during generation.
      </p>

      {importStatus && (
        <div className={`${shared.toast} ${importStatus.type === "success" ? shared.success : shared.error}`}>
          {importStatus.message}
          <button
            className={styles.testPreviewCloseBtn}
            style={{ marginLeft: 12 }}
            onClick={() => setImportStatus(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span>
            {selected.size} rule{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button className={`${shared.buttonDanger} ${shared.buttonSmall}`} onClick={handleBulkDelete}>
            Delete selected
          </button>
          <button className={`${shared.buttonSecondary} ${shared.buttonSmall}`} onClick={() => setSelected(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {rules.length === 0 && !form ? (
        <div className={shared.emptyState}>
          <p>No rules yet.</p>
          <p className={shared.hint}>Add a rule to start generating collections.</p>
        </div>
      ) : (
        <table className={shared.table}>
          <thead>
            <tr>
              <th className={styles.checkboxCell}>
                <input
                  type="checkbox"
                  checked={rules.length > 0 && selected.size === rules.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>Enabled</th>
              <th>Config</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => {
              let configSummary = "";
              try {
                const c = JSON.parse(rule.config || "{}");
                configSummary = CONFIG_SUMMARY[rule.type]?.(c) ?? `Max: ${c.limit ?? 10}`;
                if (c.sections?.length) configSummary += ` | Sections: ${c.sections.join(", ")}`;
              } catch {}

              const typeBadge = TYPE_BADGE[rule.type] ?? styles.typeCriteria;
              return (
                <tr key={rule.id}>
                  <td className={styles.checkboxCell} onClick={(e) => handleCheckboxClick(i, e)}>
                    <input type="checkbox" checked={selected.has(rule.id)} readOnly />
                  </td>
                  <td>{rule.name}</td>
                  <td>
                    <span className={`${styles.typeLabel} ${typeBadge}`}>{TYPE_LABELS[rule.type] || rule.type}</span>
                  </td>
                  <td className={styles.toggleCell}>
                    <input type="checkbox" checked={!!rule.enabled} onChange={() => handleToggle(rule)} />
                  </td>
                  <td>
                    <span className={styles.configSummary}>{configSummary}</span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {rule.lastCollectionRatingKey && (
                        <button
                          className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
                          onClick={() => navigate(`/collections/${rule.lastCollectionRatingKey}`)}
                        >
                          View
                        </button>
                      )}
                      {runMutation.isPending && runningRuleId === rule.id ? (
                        <button className={`${shared.buttonDanger} ${shared.buttonSmall}`} onClick={handleCancelRun}>
                          Cancel
                        </button>
                      ) : (
                        <button
                          className={`${shared.button} ${shared.buttonSmall}`}
                          onClick={() => handleRun(rule)}
                          disabled={runMutation.isPending || testMutation.isPending}
                        >
                          Run
                        </button>
                      )}
                      {testMutation.isPending && testingRuleId === rule.id ? (
                        <button className={`${shared.buttonDanger} ${shared.buttonSmall}`} onClick={handleCancelTest}>
                          Cancel
                        </button>
                      ) : (
                        <button
                          className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
                          onClick={() => handleTest(rule)}
                          disabled={testMutation.isPending || runMutation.isPending}
                        >
                          Test
                        </button>
                      )}
                      <button
                        className={`${shared.button} ${shared.buttonSmall}`}
                        onClick={() => startEdit(rule)}
                        disabled={!!form}
                      >
                        Edit
                      </button>
                      <button
                        className={`${shared.buttonDanger} ${shared.buttonSmall}`}
                        onClick={() => handleDelete(rule)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {runMutation.isError && (
        <div className={styles.testPreviewError}>
          Run failed: {runMutation.error?.message || "Unknown error"}
          <button className={styles.testPreviewCloseBtn} style={{ marginLeft: 12 }} onClick={() => runMutation.reset()}>
            Dismiss
          </button>
        </div>
      )}

      {testMutation.isError && (
        <div className={styles.testPreviewError}>
          Error: {testMutation.error?.message || "Test failed"}
          <button className={styles.testPreviewCloseBtn} style={{ marginLeft: 12 }} onClick={closeTestPreview}>
            Dismiss
          </button>
        </div>
      )}

      {testMutation.data && (
        <div className={styles.testPreview}>
          <div className={styles.testPreviewHeader}>
            <h3>Test Results — {rules.find((r) => r.id === testingRuleId)?.name || "Rule"}</h3>
            <button className={styles.testPreviewCloseBtn} onClick={closeTestPreview}>
              Close
            </button>
          </div>
          {testMutation.data.collections.length === 0 ? (
            <div className={styles.testPreviewEmpty}>No collections would be created by this rule.</div>
          ) : (
            testMutation.data.collections.map((col, i) => (
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
      )}

      {form && (
        <div className={styles.ruleForm}>
          <div className={styles.ruleFormField}>
            <label>Name</label>
            <input
              className={shared.input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Rule name"
            />
          </div>

          <div className={styles.ruleFormField}>
            <label>Type</label>
            <select
              className={shared.select}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              disabled={isEditing}
            >
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {form.type === "ai_prompt" && (
            <>
              <div className={styles.ruleFormField}>
                <label>Prompt Template</label>
                <textarea
                  className={styles.promptTextarea}
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  placeholder="Enter your AI prompt template..."
                />
                <span className={styles.promptHint}>
                  Available placeholders: {"{sectionTitle}"}, {"{limit}"}, {"{minItems}"}
                </span>
              </div>
              <div className={styles.ruleFormField}>
                <label>Min items per collection</label>
                <input
                  type="number"
                  className={shared.input}
                  style={{ maxWidth: 120 }}
                  min={1}
                  max={100}
                  value={form.minItems}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      minItems: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)),
                    })
                  }
                />
                <span className={styles.promptHint}>Collections with fewer matched items will be skipped</span>
              </div>
            </>
          )}

          {form.type === "imdb_chart" && (
            <div className={styles.ruleFormField}>
              <label>Chart</label>
              <select
                className={shared.select}
                value={form.chart}
                onChange={(e) => setForm({ ...form, chart: e.target.value })}
              >
                {IMDB_CHARTS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.type === "imdb_list" && (
            <div className={styles.ruleFormField}>
              <label>IMDb List ID or URL</label>
              <input
                className={shared.input}
                value={form.listId}
                onChange={(e) => setForm({ ...form, listId: e.target.value })}
                placeholder="ls123456789 or https://www.imdb.com/list/ls123456789/"
              />
            </div>
          )}

          {form.type === "rt_top_rated" && (
            <div className={styles.ruleFormField}>
              <span className={styles.promptHint}>Requires an OMDB API key configured in Settings.</span>
            </div>
          )}

          {form.type === "seerr_requests" && (
            <>
              <div className={styles.ruleFormField}>
                <label>Filter</label>
                <select
                  className={shared.select}
                  value={form.filter}
                  onChange={(e) => setForm({ ...form, filter: e.target.value })}
                >
                  {SEERR_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.ruleFormField}>
                <span className={styles.promptHint}>
                  Requires Jellyseerr/Overseerr configured in Settings &gt; Arrs.
                </span>
              </div>
            </>
          )}

          {typeHasLimit(form.type) && (
            <div className={styles.ruleFormField}>
              <label>
                {form.type === "ai_prompt"
                  ? "Collections per section"
                  : form.type === "top_rated" || form.type === "lowest_rated" || form.type === "rt_top_rated"
                    ? "Items per collection"
                    : "Max collections"}
              </label>
              <input
                type="number"
                className={shared.input}
                style={{ maxWidth: 120 }}
                min={1}
                max={maxLimitForType(form.type)}
                value={form.limit}
                onChange={(e) =>
                  setForm({
                    ...form,
                    limit: Math.max(1, Math.min(maxLimitForType(form.type), parseInt(e.target.value, 10) || 1)),
                  })
                }
              />
              <span className={styles.promptHint}>Collections replace those generated in previous runs</span>
            </div>
          )}

          {sections.length > 0 && (
            <div className={styles.ruleFormField}>
              <label>Sections</label>
              <div className={styles.configSections}>
                {sections.map((s) => (
                  <label key={s.key} className={styles.configSectionItem}>
                    <input
                      type="checkbox"
                      checked={form.sections.includes(s.title)}
                      disabled={sectionsLocked}
                      onChange={() =>
                        setForm({
                          ...form,
                          sections: form.sections.includes(s.title)
                            ? form.sections.filter((t) => t !== s.title)
                            : [...form.sections, s.title],
                        })
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
              <span className={styles.promptHint}>{sectionsLocked ? null : "Default is all sections"}</span>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              className={shared.button}
              onClick={handleSave}
              disabled={
                !form.name.trim() ||
                (form.type === "imdb_list" && !form.listId.trim()) ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {isEditing ? "Save" : "Create"}
            </button>
            <button className={shared.buttonSecondary} onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <ConfirmModal
          message={pendingConfirm.message}
          confirmLabel="Delete"
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
