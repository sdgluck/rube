import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import DropdownButton from "../DropdownButton";
import ConfirmModal from "../ConfirmModal";
import RuleWizard, { type RuleFormState, type AiVibe, type AiNameStyle } from "../RuleWizard";
import { RulesSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import { useToast } from "../Toast";
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

const SEERR_FILTERS = [
  { value: "all", label: "All Requests" },
  { value: "approved", label: "Approved" },
  { value: "available", label: "Available" },
  { value: "pending", label: "Pending" },
];

const SEERR_FILTER_LABELS: Record<string, string> = Object.fromEntries(SEERR_FILTERS.map((f) => [f.value, f.label]));

const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));

const CONFIG_SUMMARY: Record<string, (c: Record<string, unknown>) => string> = {
  ai_prompt: (c) => {
    const themes = (c.themes as string[] | undefined) ?? [];
    const custom = ((c.customThemes as string[] | undefined) ?? []).filter((t) => t.trim().length > 0);
    const all = [...themes, ...custom];
    const themeText = all.length === 0 ? "no themes" : `${all.length} theme${all.length !== 1 ? "s" : ""}`;
    return `${themeText} | Limit: ${c.limit ?? 8} | Min items: ${c.minItems ?? 15}`;
  },
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

const EMPTY_FORM: RuleFormState = {
  name: "",
  type: "ai_prompt",
  themes: ["Vibes & tone", "Unexpected pairings"],
  customThemes: [],
  vibe: "mixed",
  nameStyle: "short_punchy",
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

function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list";
}

export default function Rules() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const rulesQuery = trpc.rules.list.useQuery();
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

  const [form, setForm] = useState<RuleFormState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const { addToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastClickedIndex = useRef<number | null>(null);

  const rules = rulesQuery.data || [];

  function getExportData() {
    return rules.map((r) => ({
      name: r.name,
      type: r.type,
      enabled: !!r.enabled,
      config: r.config ?? {},
    }));
  }

  function handleExportFile() {
    downloadJson(getExportData(), "tinkerbell-rules.json");
  }

  async function handleExportClipboard() {
    await navigator.clipboard.writeText(JSON.stringify(getExportData(), null, 2));
    addToast("Copied rules to clipboard", "success");
  }

  async function importRules(text: string) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Expected an array of rules");
    let count = 0;
    for (const rule of data) {
      await createMutation.mutateAsync({
        name: rule.name,
        type: rule.type,
        config: rule.config ?? {},
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
    addToast(`Imported ${count} rule${count !== 1 ? "s" : ""}`, "success");
  }

  async function handleImportFile(file: File) {
    try {
      await importRules(await file.text());
    } catch (err) {
      addToast(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImportClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await importRules(text);
    } catch (err) {
      addToast(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    }
  }

  function startCreate() {
    setForm({ ...EMPTY_FORM });
    setIsEditing(false);
  }

  function startEdit(rule: (typeof rules)[0]) {
    const config = rule.config ?? {};
    setForm({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      themes: (config.themes as string[]) || [],
      customThemes: (config.customThemes as string[]) || [],
      vibe: ((config.vibe as AiVibe) || "mixed") satisfies AiVibe,
      nameStyle: ((config.nameStyle as AiNameStyle) || "short_punchy") satisfies AiNameStyle,
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

  function handleSave(next: RuleFormState) {
    const config: Record<string, unknown> = {};
    if (typeHasLimit(next.type)) config.limit = next.limit;
    if (next.type === "ai_prompt") {
      config.themes = next.themes;
      config.customThemes = next.customThemes.filter((t) => t.trim().length > 0);
      config.vibe = next.vibe;
      config.nameStyle = next.nameStyle;
      config.minItems = next.minItems;
    }
    if (next.type === "imdb_chart") config.chart = next.chart;
    if (next.type === "imdb_list") config.listId = next.listId;
    if (next.type === "seerr_requests") config.filter = next.filter;
    if (next.sections.length > 0) config.sections = next.sections;

    if (isEditing && next.id) {
      updateMutation.mutate({ id: next.id, name: next.name, config }, { onSuccess: () => cancelForm() });
    } else {
      createMutation.mutate({ name: next.name, type: next.type, config }, { onSuccess: () => cancelForm() });
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

  if (rulesQuery.isLoading) return <RulesSkeleton />;

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
        <EmptyState icon="cog" title="No rules yet" description="Add a rule to start generating collections." />
      ) : (
        <div className="table-scroll">
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
                const c = rule.config ?? {};
                let configSummary = CONFIG_SUMMARY[rule.type]?.(c) ?? `Max: ${(c as { limit?: number }).limit ?? 10}`;
                const sections = (c as { sections?: string[] }).sections;
                if (sections?.length) configSummary += ` | Sections: ${sections.join(", ")}`;

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
        </div>
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
        <RuleWizard
          open
          mode={isEditing ? "edit" : "create"}
          initial={form}
          saving={createMutation.isPending || updateMutation.isPending}
          onSave={handleSave}
          onCancel={cancelForm}
        />
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
