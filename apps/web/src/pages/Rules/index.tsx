import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmModal from "#components/ConfirmModal";
import DropdownButton from "#components/DropdownButton";
import EmptyState from "#components/EmptyState";
import RuleWizard, {
  type AiNameStyle,
  type AiVibe,
  type RuleFormState,
  type SmartFilterGroup,
  DEFAULT_ARR_FORM,
} from "#pages/Rules/RuleWizard";
import { RulesSkeleton } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import shared from "#pages/Collections.module.css";
import MigrationBanner from "./MigrationBanner";
import BulkActionsBar from "./BulkActionsBar";
import BulkEditModal from "./BulkEditModal";
import { EMPTY_FORM, defaultLimitForType, typeHasLimit } from "./constants";
import RuleTableRow from "./RuleTableRow";
import styles from "./Rules.module.css";
import RulesToolbar from "./Toolbar";
import type { EnabledFilter, RuleRow, SortKey } from "./types";
import { downloadJson } from "./utils";

export default function Rules() {
  const utils = trpc.useUtils();
  const rulesQuery = trpc.rules.list.useQuery();
  const createMutation = trpc.rules.create.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const updateMutation = trpc.rules.update.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const deleteMutation = trpc.rules.delete.useMutation({ onSuccess: () => utils.rules.list.invalidate() });

  const testMutation = trpc.rules.test.useMutation();
  const cancelTestMutation = trpc.rules.cancelTest.useMutation();
  const testingRuleIdRef = useRef<string | null>(null);

  const runMutation = trpc.rules.run.useMutation();
  const cancelRunMutation = trpc.rules.cancelRun.useMutation();
  const runningRuleIdRef = useRef<string | null>(null);

  const [form, setForm] = useState<RuleFormState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const { addToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [expandedRow, setExpandedRow] = useState<string | null>(
    () => (typeof window !== "undefined" && sessionStorage.getItem("rules-expanded-row")) || null,
  );
  const [expandedConfig, setExpandedConfig] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const raw = sessionStorage.getItem("rules-expanded-config");
    if (!raw) return new Set();
    try {
      const ids = JSON.parse(raw);
      return Array.isArray(ids) ? new Set(ids) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (expandedRow) sessionStorage.setItem("rules-expanded-row", expandedRow);
    else sessionStorage.removeItem("rules-expanded-row");
  }, [expandedRow]);

  useEffect(() => {
    if (expandedConfig.size > 0) {
      sessionStorage.setItem("rules-expanded-config", JSON.stringify([...expandedConfig]));
    } else {
      sessionStorage.removeItem("rules-expanded-config");
    }
  }, [expandedConfig]);

  const allRules = (rulesQuery.data ?? []) as RuleRow[];

  const presentTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRules) s.add(r.type);
    return Array.from(s);
  }, [allRules]);

  const rules = useMemo(() => {
    let out = allRules;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
    }
    if (typeFilter !== "all") out = out.filter((r) => r.type === typeFilter);
    if (enabledFilter === "enabled") out = out.filter((r) => !!r.enabled);
    else if (enabledFilter === "disabled") out = out.filter((r) => !r.enabled);
    out = [...out].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else if (sortKey === "lastRun") cmp = (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [allRules, search, typeFilter, enabledFilter, sortKey, sortDir]);

  function getExportData() {
    return allRules.map((r) => ({
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

  function startEdit(rule: RuleRow) {
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
      listProvider: ((config.listProvider as RuleFormState["listProvider"]) ||
        "mdblist") satisfies RuleFormState["listProvider"],
      collectionName: (config.collectionName as string) || "",
      smartFilter: (config.smartFilter as SmartFilterGroup | undefined) ?? {
        kind: "group",
        combinator: "all",
        children: [],
      },
      filter: (config.filter as string) || "all",
      pinToHomepage: (config.pinToHomepage as boolean | undefined) ?? true,
      arr: {
        ...DEFAULT_ARR_FORM,
        ...(config.arr as Partial<typeof DEFAULT_ARR_FORM> | undefined),
      },
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
    if (next.type === "list_source") {
      config.listProvider = next.listProvider;
      config.listId = next.listId;
      if (next.collectionName.trim()) config.collectionName = next.collectionName.trim();
    }
    if (next.type === "smart_filter") {
      config.smartFilter = next.smartFilter;
      if (next.collectionName.trim()) config.collectionName = next.collectionName.trim();
    }
    if (next.type === "seerr_requests") config.filter = next.filter;
    if (next.sections.length > 0) config.sections = next.sections;
    if (!next.pinToHomepage) config.pinToHomepage = false;
    if (next.arr.enabled) config.arr = next.arr;

    if (isEditing && next.id) {
      updateMutation.mutate({ id: next.id, name: next.name, config }, { onSuccess: () => cancelForm() });
    } else {
      createMutation.mutate({ name: next.name, type: next.type, config }, { onSuccess: () => cancelForm() });
    }
  }

  function handleToggle(rule: RuleRow) {
    updateMutation.mutate({ id: rule.id, enabled: !rule.enabled });
  }

  function handleDuplicate(rule: RuleRow) {
    const baseName = `${rule.name} (copy)`;
    const existing = new Set(allRules.map((r) => r.name));
    let name = baseName;
    let n = 2;
    while (existing.has(name)) name = `${baseName} ${n++}`;
    createMutation.mutate(
      { name, type: rule.type, config: rule.config ?? {} },
      {
        onSuccess: (created) => {
          if (!rule.enabled && created?.id) {
            updateMutation.mutate({ id: created.id, enabled: false });
          }
          addToast(`Duplicated "${rule.name}"`, "success");
        },
      },
    );
  }

  function handleDelete(rule: RuleRow) {
    setPendingConfirm({
      message: `Delete rule "${rule.name}"?`,
      onConfirm: () => {
        deleteMutation.mutate({ id: rule.id });
        setPendingConfirm(null);
      },
    });
  }

  function handleCheckboxClick(index: number, opts: { shiftKey: boolean }) {
    const id = rules[index].id;
    const isShift = opts.shiftKey;

    if (isShift && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(rules[i].id);
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
    if (selected.size === rules.length && rules.length > 0) setSelected(new Set());
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

  async function handleBulkEditApply(patch: { limit?: number }) {
    setBulkEditOpen(false);
    const eligibleRules = allRules.filter((r) => selected.has(r.id) && typeHasLimit(r.type));
    let updated = 0;
    for (const rule of eligibleRules) {
      const config = { ...rule.config };
      if (patch.limit !== undefined) config.limit = patch.limit;
      await updateMutation.mutateAsync({ id: rule.id, config });
      updated++;
    }
    utils.rules.list.invalidate();
    addToast(`Updated ${updated} rule${updated !== 1 ? "s" : ""}`, "success");
  }

  async function handleBulkSetEnabled(enabled: boolean) {
    for (const id of selected) {
      await updateMutation.mutateAsync({ id, enabled });
    }
    utils.rules.list.invalidate();
    addToast(`${enabled ? "Enabled" : "Disabled"} ${selected.size} rule${selected.size !== 1 ? "s" : ""}`, "success");
  }

  async function handleBulkRun() {
    const ids = Array.from(selected);
    addToast(`Running ${ids.length} rule${ids.length !== 1 ? "s" : ""} sequentially…`, "info");
    let okCount = 0;
    let errCount = 0;
    for (const id of ids) {
      try {
        await runRule(id);
        okCount++;
      } catch {
        errCount++;
      }
    }
    addToast(`Bulk run complete — ${okCount} ok, ${errCount} failed`, errCount === 0 ? "success" : "error");
  }

  async function handleBulkTest() {
    const ids = Array.from(selected);
    for (const id of ids) {
      try {
        await testRule(id);
      } catch {
        // continue
      }
    }
    addToast(`Tested ${ids.length} rule${ids.length !== 1 ? "s" : ""}`, "info");
  }

  function testRule(id: string): Promise<unknown> {
    setTestingRuleId(id);
    setExpandedRow(id);
    testingRuleIdRef.current = id;
    return testMutation.mutateAsync({ id }).finally(() => {
      testingRuleIdRef.current = null;
      setTestingRuleId(null);
      utils.rules.list.invalidate();
      utils.rules.lastTestResult.invalidate({ id });
    });
  }

  function runRule(id: string): Promise<unknown> {
    setRunningRuleId(id);
    setExpandedRow(id);
    runningRuleIdRef.current = id;
    return runMutation
      .mutateAsync({ id })
      .then((result) => {
        const rule = allRules.find((r) => r.id === id);
        addToast(
          `Ran "${rule?.name ?? "rule"}"${(result as { lastCollectionKey?: string | null })?.lastCollectionKey ? "" : " (no collections created)"}`,
          "success",
        );
        return result;
      })
      .finally(() => {
        runningRuleIdRef.current = null;
        setRunningRuleId(null);
        utils.rules.list.invalidate();
      });
  }

  function handleTest(rule: RuleRow) {
    void testRule(rule.id).catch(() => {
      // error captured per-row; mutation state is also reset on next test
    });
  }

  function handleCancelTest() {
    if (testingRuleId) {
      cancelTestMutation.mutate({ id: testingRuleId });
    }
    testingRuleIdRef.current = null;
    setTestingRuleId(null);
    testMutation.reset();
  }

  function handleRun(rule: RuleRow) {
    void runRule(rule.id).catch(() => {});
  }

  function handleCancelRun() {
    if (runningRuleId) {
      cancelRunMutation.mutate({ id: runningRuleId });
    }
    runningRuleIdRef.current = null;
    setRunningRuleId(null);
    runMutation.reset();
  }

  function toggleConfigExpand(id: string) {
    setExpandedConfig((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRowExpand(id: string) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  useEffect(() => {
    return () => {
      if (testingRuleIdRef.current) {
        cancelTestMutation.mutate({ id: testingRuleIdRef.current });
      }
      if (runningRuleIdRef.current) {
        cancelRunMutation.mutate({ id: runningRuleIdRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (editable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" && !form) {
        e.preventDefault();
        startCreate();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [form]);

  if (rulesQuery.isLoading) return <RulesSkeleton />;

  const allSelected = rules.length > 0 && rules.every((r) => selected.has(r.id));

  return (
    <div>
      <MigrationBanner />
      <div className={shared.header}>
        <h2 className={shared.heading}>
          Rules{allRules.length > 0 && <span className="count-badge">{allRules.length}</span>}
        </h2>
        <div className={shared.headerActions}>
          <DropdownButton
            label="Export"
            className={shared.buttonSecondary}
            disabled={allRules.length === 0}
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

      {allRules.length > 0 && (
        <RulesToolbar
          searchInputRef={searchInputRef}
          search={search}
          onSearchChange={setSearch}
          presentTypes={presentTypes}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          enabledFilter={enabledFilter}
          onEnabledFilterChange={setEnabledFilter}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={(k, d) => {
            setSortKey(k);
            setSortDir(d);
          }}
        />
      )}

      {selected.size > 0 && (
        <BulkActionsBar
          count={selected.size}
          onEnable={() => handleBulkSetEnabled(true)}
          onDisable={() => handleBulkSetEnabled(false)}
          onTest={handleBulkTest}
          onRun={handleBulkRun}
          onEdit={() => setBulkEditOpen(true)}
          onDelete={handleBulkDelete}
          onCancel={() => setSelected(new Set())}
          editDisabled={!allRules.some((r) => selected.has(r.id) && typeHasLimit(r.type))}
          updatePending={updateMutation.isPending}
          testPending={testMutation.isPending}
          runPending={runMutation.isPending}
        />
      )}

      {allRules.length === 0 && !form ? (
        <EmptyState icon="cog" title="No rules yet" description="Add a rule to start generating collections." />
      ) : rules.length === 0 ? (
        <EmptyState icon="cog" title="No matching rules" description="Try a different search or filter." />
      ) : (
        <div className="table-scroll">
          <table className={shared.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    aria-label="Select all rules"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Name</th>
                <th>Type</th>
                <th>Enabled</th>
                <th>Status</th>
                <th>Config</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const isTesting = testMutation.isPending && testingRuleId === rule.id;
                const isRunning = runMutation.isPending && runningRuleId === rule.id;
                return (
                  <RuleTableRow
                    key={rule.id}
                    rule={rule}
                    index={i}
                    selected={selected.has(rule.id)}
                    onCheckboxClick={handleCheckboxClick}
                    onToggleEnabled={() => handleToggle(rule)}
                    isTesting={isTesting}
                    isRunning={isRunning}
                    isExpanded={expandedRow === rule.id}
                    onToggleRowExpand={() => toggleRowExpand(rule.id)}
                    configExpanded={expandedConfig.has(rule.id)}
                    onToggleConfigExpand={() => toggleConfigExpand(rule.id)}
                    formActive={!!form}
                    testPending={testMutation.isPending}
                    runPending={runMutation.isPending}
                    createPending={createMutation.isPending}
                    onRun={() => handleRun(rule)}
                    onCancelRun={handleCancelRun}
                    onTest={() => handleTest(rule)}
                    onCancelTest={handleCancelTest}
                    onEdit={() => startEdit(rule)}
                    onDuplicate={() => handleDuplicate(rule)}
                    onDelete={() => handleDelete(rule)}
                    onDetailCleared={() => setExpandedRow(null)}
                  />
                );
              })}
            </tbody>
          </table>
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

      {bulkEditOpen && (
        <BulkEditModal
          eligibleCount={allRules.filter((r) => selected.has(r.id) && typeHasLimit(r.type)).length}
          totalSelected={selected.size}
          onApply={handleBulkEditApply}
          onCancel={() => setBulkEditOpen(false)}
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
