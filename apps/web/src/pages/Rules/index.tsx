import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useListParams } from "#hooks/useListParams";
import { readEnum } from "#/storage";
import ConfirmModal from "#components/ConfirmModal";
import DropdownButton from "#components/DropdownButton";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell from "#components/PageShell";
import RuleWizard, {
  type AiNameStyle,
  type AiVibe,
  type RuleFormState,
  type SmartFilterGroup,
  DEFAULT_ARR_FORM,
} from "#pages/Rules/RuleWizard";
import { RulesSkeleton } from "#components/Skeleton";
import SortableTh from "#components/SortableTh";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import shared from "#/styles/shared.module.css";
import MigrationBanner from "./MigrationBanner";
import RegistryUpdatesBanner from "./RegistryUpdatesBanner";
import BulkBar from "#components/BulkBar";
import BulkEditModal from "./BulkEditModal";
import { useTagLabels } from "#components/smart-filter/TagValueSelect.tsx";
import {
  EMPTY_FORM,
  outcomeFromConfig,
  defaultLimitForType,
  smartFilterLeaves,
  typeHasLimit,
  typeHasMinItems,
  typeHasOptionalLimit,
} from "./constants";
import RuleTableRow from "./RuleTableRow";
import styles from "./Rules.module.css";
import RulesToolbar from "./Toolbar";
import { ENABLED_FILTERS, SORT_KEYS, type EnabledFilter, type RuleRow, type SortKey } from "./types";
import { downloadJson } from "./utils";

/**
 * Which rules this instance of the list shows.
 *
 * A cleanup rule and a collection rule stopped resembling each other when
 * cleanup landed — the Config and Status columns mean different things for
 * each, and the wizard already asks Outcome before anything that depends on
 * it. So the two get their own lists: collection rules stay on /rules, cleanup
 * rules live next to the queue they feed, on /cleanup/rules.
 */
export type RulesOutcome = "collection" | "cleanup";

export default function Rules({ outcome = "collection" }: { outcome?: RulesOutcome } = {}) {
  const utils = trpc.useUtils();
  // Queued/actioned tallies for cleanup rules, one query for the whole table.
  const cleanupCountsQuery = trpc.cleanup.counts.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const cleanupCounts = cleanupCountsQuery.data ?? {};
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

  /**
   * Search, filters and sort live in the URL, like every other list page, so
   * the view is shareable and survives a reload.
   *
   * Column headers and the toolbar's sort dropdown drive the same params, so
   * the two controls can never disagree about how the table is ordered.
   * "Status" is the last run, which is most useful newest-first.
   */
  const { sortKey, sortDir, param, listParam, setParam, setListParam, setParams, toggleSort } = useListParams<SortKey>({
    sortKeys: SORT_KEYS,
    defaultSortKey: "name",
    descFirst: ["lastRun"],
  });

  /**
   * Links that point at one specific rule — from Collections, Preview, a
   * collection's detail page — carry that rule's name as `?q`, so arriving at
   * the page narrows the table to it and the search box shows what it was
   * narrowed by.
   */
  const search = param("q");
  const setSearch = useCallback((value: string) => setParam("q", value), [setParam]);
  // Empty = no type filter. Was a single `string | "all"`; the toolbar now
  // filters on any combination of types.
  const typeFilter = listParam("type");
  const setTypeFilter = useCallback((values: string[]) => setListParam("type", values), [setListParam]);
  const enabledFilter = readEnum(param("enabled"), ENABLED_FILTERS, "all");
  const setEnabledFilter = useCallback(
    (value: EnabledFilter) => setParam("enabled", value === "all" ? "" : value),
    [setParam],
  );

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedPreview, setExpandedPreview] = useState<string | null>(null);
  const togglePreviewExpand = (id: string) => {
    setExpandedPreview((prev) => {
      const next = prev === id ? null : id;
      if (next) setExpandedRow(null);
      return next;
    });
  };
  // Narrowed before anything else reads it: the type filter's options, the
  // bulk-selection set and the duplicate-name check should all see the list
  // the user is actually looking at.
  const allRules = useMemo(
    () =>
      ((rulesQuery.data ?? []) as RuleRow[]).filter(
        (r) => outcomeFromConfig((r.config as { action?: unknown } | null)?.action).kind === outcome,
      ),
    [rulesQuery.data, outcome],
  );

  const hiddenCleanupCount = useMemo(
    () =>
      ((rulesQuery.data ?? []) as RuleRow[]).filter(
        (r) => outcomeFromConfig((r.config as { action?: unknown } | null)?.action).kind === "cleanup",
      ).length,
    [rulesQuery.data],
  );

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
    if (typeFilter.length > 0) out = out.filter((r) => typeFilter.includes(r.type));
    if (enabledFilter === "enabled") out = out.filter((r) => !!r.enabled);
    else if (enabledFilter === "disabled") out = out.filter((r) => !r.enabled);
    out = [...out].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else if (sortKey === "enabled") cmp = Number(!!a.enabled) - Number(!!b.enabled);
      else if (sortKey === "lastRun") cmp = (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [allRules, search, typeFilter, enabledFilter, sortKey, sortDir]);

  // Smart-filter rules imported from Plex store per-server tag keys, so the
  // Config column would otherwise read "Genre is 92". One lookup covers every
  // row — the tag fields used across all of them, resolved together.
  const smartFilterTagFields = useMemo(
    () =>
      allRules
        .filter((r) => r.type === "smart_filter")
        .flatMap((r) => smartFilterLeaves((r.config as { smartFilter?: unknown } | null)?.smartFilter))
        .map((l) => l.field),
    [allRules],
  );
  const resolveTag = useTagLabels(smartFilterTagFields);

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
    // Seeded to match the list you started from — creating a rule from the
    // cleanup list and getting a collection rule you then can't find would be
    // its own bug report. The Outcome step still shows, and still switches.
    setForm({ ...EMPTY_FORM, outcome: { ...EMPTY_FORM.outcome, kind: outcome } });
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
      // Absent means "off" for grouped rules; ai_prompt keeps its 15 floor.
      minItems: (config.minItems as number) ?? (rule.type === "ai_prompt" ? 15 : 0),
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
      pinRotationCount: (config.pinRotationCount as number | undefined) ?? 0,
      pinMinItems: (config.pinMinItems as number | undefined) ?? 0,
      outcome: outcomeFromConfig(config.action),
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
    // Optional knobs are written only when enabled — an absent key is what
    // the job reads as "no cap" / "no minimum".
    if (typeHasLimit(next.type) && (!typeHasOptionalLimit(next.type) || next.limit > 0)) config.limit = next.limit;
    if (typeHasMinItems(next.type) && next.minItems > 0) config.minItems = next.minItems;
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
    // The cleanup path pins its shelf `false` unconditionally, so writing any
    // of these onto a cleanup rule would store settings nothing reads. A rule
    // switched from collection to cleanup sheds them here; switched back, it
    // starts from the wizard's defaults rather than a stale saved answer.
    if (next.outcome.kind === "collection") {
      if (!next.pinToHomepage) config.pinToHomepage = false;
      if (next.pinToHomepage && next.pinRotationCount > 0) config.pinRotationCount = next.pinRotationCount;
      if (next.pinToHomepage && next.pinMinItems > 0) config.pinMinItems = next.pinMinItems;
    }
    if (next.arr.enabled) config.arr = next.arr;
    // Absent means "build a collection" — the same reading the job takes — so
    // a collection rule writes no action key at all and stays byte-identical
    // to how it was stored before this existed.
    if (next.outcome.kind === "cleanup") {
      const { kind: _kind, ...cleanup } = next.outcome;
      config.action = { kind: "cleanup", ...cleanup };
    }

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
        // Per-rule failure is non-fatal — keep running the rest of the
        // selection. The aggregate counts surface in the toast below.
        errCount++;
      }
    }
    addToast(`Bulk run complete — ${okCount} ok, ${errCount} failed`, errCount === 0 ? "success" : "error");
  }

  async function handleBulkTest() {
    const ids = Array.from(selected);
    let okCount = 0;
    let errCount = 0;
    for (const id of ids) {
      try {
        await testRule(id);
        okCount++;
      } catch {
        // Per-rule failure is non-fatal — keep running the rest of the
        // selection. Aggregate counts surface in the toast below.
        errCount++;
      }
    }
    if (errCount > 0) {
      addToast(`Bulk test — ${okCount} ok, ${errCount} failed`, "error");
    }
    addToast(`Tested ${ids.length} rule${ids.length !== 1 ? "s" : ""}`, "info");
  }

  function testRule(id: string): Promise<unknown> {
    setTestingRuleId(id);
    // expandedRow drives both the in-flight log view and the post-completion
    // test-results preview, so we leave it set on success.
    setExpandedRow(id);
    setExpandedPreview(null);
    testingRuleIdRef.current = id;
    return testMutation
      .mutateAsync({ id })
      .catch((err) => {
        // On error/cancel collapse — the status cell tooltip carries the message.
        setExpandedRow(null);
        throw err;
      })
      .finally(() => {
        testingRuleIdRef.current = null;
        setTestingRuleId(null);
        utils.rules.list.invalidate();
        utils.rules.lastTestResult.invalidate({ id });
      });
  }

  function runRule(id: string): Promise<unknown> {
    setRunningRuleId(id);
    // While the run is in-flight, expandedRow drives the inline log view.
    // After completion we collapse it and (if a collection was produced)
    // open the Plex-style preview row instead — see `.then` below.
    setExpandedRow(id);
    setExpandedPreview(null);
    runningRuleIdRef.current = id;
    return runMutation
      .mutateAsync({ id })
      .then((result) => {
        const rule = allRules.find((r) => r.id === id);
        const lastCollectionKey = (result as { lastCollectionKey?: string | null })?.lastCollectionKey;
        addToast(`Ran "${rule?.name ?? "rule"}"${lastCollectionKey ? "" : " (no collections created)"}`, "success");
        // Swap the in-flight log view for the result preview. If no collection
        // was created there's nothing to preview, so just collapse.
        setExpandedRow(null);
        if (lastCollectionKey) setExpandedPreview(id);
        return result;
      })
      .catch((err) => {
        // On error/cancel the log view should not stick around — the status
        // cell carries the error message via its tooltip.
        setExpandedRow(null);
        throw err;
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
  if (rulesQuery.error) {
    return <ErrorState title="Couldn't load rules" error={rulesQuery.error} onRetry={() => rulesQuery.refetch()} />;
  }

  const allSelected = rules.length > 0 && rules.every((r) => selected.has(r.id));

  return (
    <PageShell
      count={allRules.length > 0 ? allRules.length.toLocaleString() : undefined}
      actions={
        <>
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
        </>
      }
    >
      <MigrationBanner />
      <RegistryUpdatesBanner />

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
          onSortChange={(k, d) => setParams({ sort: k, dir: d })}
        />
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          noun="rule"
          onClear={() => setSelected(new Set())}
          actions={[
            { label: "Enable", onClick: () => handleBulkSetEnabled(true), disabled: updateMutation.isPending },
            { label: "Disable", onClick: () => handleBulkSetEnabled(false), disabled: updateMutation.isPending },
            {
              label: "Test",
              onClick: handleBulkTest,
              disabled: testMutation.isPending || runMutation.isPending,
            },
            {
              label: "Run",
              tone: "primary",
              onClick: handleBulkRun,
              disabled: testMutation.isPending || runMutation.isPending,
            },
            {
              label: "Edit…",
              onClick: () => setBulkEditOpen(true),
              disabled: !allRules.some((r) => selected.has(r.id) && typeHasLimit(r.type)) || updateMutation.isPending,
              title: "Edit common config options",
            },
            { label: "Delete", tone: "danger", onClick: handleBulkDelete },
          ]}
        />
      )}

      {allRules.length === 0 && !form ? (
        outcome === "cleanup" ? (
          <EmptyState
            icon="cog"
            title="No cleanup rules yet"
            description="A cleanup rule finds items to remove instead of building a collection. What it matches is queued here first, and nothing is acted on until an item has matched several runs in a row."
          />
        ) : (
          <EmptyState icon="cog" title="No rules yet" description="Add a rule to start generating collections." />
        )
      ) : rules.length === 0 ? (
        <EmptyState icon="cog" title="No matching rules" description="Try a different search or filter." />
      ) : (
        <div className={`table-scroll ${styles.tableBleedRight}`}>
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
                <SortableTh sortKey="name" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Name
                </SortableTh>
                <SortableTh sortKey="type" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Type
                </SortableTh>
                <SortableTh sortKey="enabled" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Enabled
                </SortableTh>
                <SortableTh sortKey="lastRun" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Status
                </SortableTh>
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
                    previewExpanded={expandedPreview === rule.id}
                    onTogglePreview={() => togglePreviewExpand(rule.id)}
                    formActive={!!form}
                    testPending={testMutation.isPending}
                    runPending={runMutation.isPending}
                    createPending={createMutation.isPending}
                    onRun={() => handleRun(rule)}
                    onCancelRun={handleCancelRun}
                    onTest={() => handleTest(rule)}
                    resolveTag={resolveTag}
                    cleanup={cleanupCounts[rule.id]}
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

      {/* Rules that exist but aren't in this list. Without this line, a cleanup
          rule created before the split just isn't where its author left it. */}
      {outcome === "collection" && hiddenCleanupCount > 0 && (
        <p className={styles.otherOutcomeHint}>
          <Link to="/cleanup/rules">
            {hiddenCleanupCount} cleanup rule{hiddenCleanupCount === 1 ? "" : "s"}
          </Link>{" "}
          {hiddenCleanupCount === 1 ? "lives" : "live"} on the Cleanup page.
        </p>
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
          title="Delete rule?"
          message={pendingConfirm.message}
          confirmLabel="Delete"
          danger
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </PageShell>
  );
}
