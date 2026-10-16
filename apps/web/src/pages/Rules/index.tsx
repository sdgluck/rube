import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { RuleSeed } from "#/lib/ruleSeed";
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
  arrConfigFromForm,
  arrFormFromConfig,
} from "#pages/Rules/RuleWizard";
import { RulesSkeleton } from "#components/Skeleton";
import SortableTh from "#components/SortableTh";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import {
  isPersonalizableAction,
  rotatesPins,
  ruleCollectionCount,
  type RuleAction,
  type RuleConfig,
} from "@tinkerbell/contracts";
import shared from "#/styles/shared.module.css";
import MigrationBanner from "./MigrationBanner";
import RegistryUpdatesBanner from "./RegistryUpdatesBanner";
import ConflictsBanner from "./ConflictsBanner";
import BulkBar from "#components/BulkBar";
import BulkEditModal, { type BulkEditPatch } from "./BulkEditModal";
import { useTagLabels } from "#components/smart-filter/TagValueSelect.tsx";
import {
  EMPTY_FORM,
  outcomeFromConfig,
  presentationFromConfig,
  scheduleFromConfig,
  scheduleToConfig,
  defaultLimitForType,
  smartFilterLeaves,
  typeHasLimit,
  typeHasMinItems,
  typeHasOptionalLimit,
} from "./constants";
import { presetFromFilter } from "./RuleWizard/cleanup-presets.ts";
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
export type RulesOutcome = "collection" | "cleanup" | "metadata";

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
  const setPersonalizableMutation = trpc.rules.setPersonalizable.useMutation();
  const deleteMutation = trpc.rules.delete.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const restoreMutation = trpc.rules.restore.useMutation();
  const reorderMutation = trpc.rules.reorder.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate();
      // The running order is half of what makes two rules a conflict, so the
      // banner has to be re-read once it changes.
      utils.rules.conflicts.invalidate();
    },
  });
  const revertArtworkMutation = trpc.rules.revertArtwork.useMutation();

  const testMutation = trpc.rules.test.useMutation();
  const runMutation = trpc.rules.run.useMutation();
  const cancelRunMutation = trpc.rules.cancelRun.useMutation();

  /**
   * What's in flight, according to the server rather than this tab.
   *
   * The table used to derive "running" from the run mutation's own pending
   * state, which meant the row existed only as long as one HTTP request in one
   * tab: a reload, a proxy timeout or a closed lid and the run vanished from
   * the UI while carrying on happily on the server. Polling the run rows shows
   * every run — this tab's, another tab's, and the ones the nightly Generate
   * job is executing in a worker thread.
   */
  const activeRunsQuery = trpc.rules.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const activeByRule = useMemo(() => {
    const map = new Map<string, NonNullable<typeof activeRunsQuery.data>[number]>();
    for (const run of activeRunsQuery.data ?? []) {
      // A rule can have a run and a test in flight at once; the run is the one
      // worth showing, being the one that changes anything.
      const existing = map.get(run.ruleId);
      if (!existing || (existing.phase === "test" && run.phase === "run")) map.set(run.ruleId, run);
    }
    return map;
  }, [activeRunsQuery.data]);

  // Cleanup rules live under /cleanup/rules, so their run history does too.
  const runsHref = useCallback(
    (ruleId: string) =>
      `${outcome === "cleanup" ? "/cleanup/rules" : outcome === "metadata" ? "/metadata/rules" : "/rules"}/${ruleId}/runs`,
    [outcome],
  );

  const [form, setForm] = useState<RuleFormState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { addToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
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
    descFirst: ["lastRun", "runs"],
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
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
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

  const hiddenMetadataCount = useMemo(
    () =>
      ((rulesQuery.data ?? []) as RuleRow[]).filter(
        (r) => outcomeFromConfig((r.config as { action?: unknown } | null)?.action).kind === "metadata",
      ).length,
    [rulesQuery.data],
  );

  /**
   * Where each rule sits in the running order *of this page*.
   *
   * `position` is a single sequence across every rule in the install, but each
   * Rules page shows one ending — so the only cleanup rule on an install that
   * also has a collection rule holds position 1 and would read as "2". The
   * engine still runs the global order; within one ending, the relative order
   * is all these numbers claim to describe. Independent of the table's current
   * sort, so the number stays put when sorting by name.
   */
  const orderIndexById = useMemo(() => {
    const ordered = [...allRules].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
    return new Map(ordered.map((r, i) => [r.id, i]));
  }, [allRules]);

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
      // The running order the engine actually uses: position, then creation,
      // which is what `getRules` orders by on the server.
      if (sortKey === "order") cmp = a.position - b.position || a.createdAt - b.createdAt;
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else if (sortKey === "enabled") cmp = Number(!!a.enabled) - Number(!!b.enabled);
      else if (sortKey === "lastRun") cmp = (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0);
      else if (sortKey === "runs") cmp = a.runCount - b.runCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [allRules, search, typeFilter, enabledFilter, sortKey, sortDir]);

  /**
   * Drag a rule to a new place in the running order.
   *
   * Only while the table is sorted by that order, and only when no filter is
   * narrowing it — dropping a row into a list showing eight of forty rules
   * would have to guess what "third" meant among the thirty-two it is not
   * showing, and any guess would silently reorder rules the user cannot see.
   */
  const canReorder =
    sortKey === "order" &&
    sortDir === "asc" &&
    search.trim() === "" &&
    typeFilter.length === 0 &&
    enabledFilter === "all";
  const [dragId, setDragId] = useState<string | null>(null);

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = rules.map((r) => r.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragId(null);
    reorderMutation.mutate({ ids });
  }

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

  /** Does this rule ask for generated artwork? Drives the revert affordance. */
  function generatesArtwork(rule: RuleRow): boolean {
    return presentationFromConfig((rule.config as { presentation?: unknown } | null)?.presentation).poster !== "none";
  }

  function startCreate() {
    // Seeded to match the list you started from — creating a rule from the
    // cleanup list and getting a collection rule you then can't find would be
    // its own bug report. The Outcome step still shows, and still switches.
    //
    // The default type is seeded the same way: `ai_prompt` isn't offered on the
    // cleanup or metadata paths, so starting there left the Type step with a
    // selection that wasn't on screen.
    setForm({
      ...EMPTY_FORM,
      type: outcome === "collection" ? EMPTY_FORM.type : "smart_filter",
      outcome: { ...EMPTY_FORM.outcome, kind: outcome },
    });
    setIsEditing(false);
  }

  /**
   * Open the wizard on a rule another page has already half-written — a Media
   * view turned into a smart filter, or a list Discover found.
   *
   * Arrives as router state rather than query params: the filter tree is a
   * nested object, and round-tripping it through a URL would mean inventing an
   * encoding for something that only has to survive one navigation.
   *
   * Cleared from history immediately, so a reload or a back-and-forward
   * doesn't reopen the wizard on a rule the user already dismissed.
   */
  useEffect(() => {
    const seed = (location.state as { ruleSeed?: RuleSeed } | null)?.ruleSeed;
    if (!seed) return;
    navigate(location.pathname, { replace: true, state: null });
    setForm(
      seed.kind === "list_source"
        ? {
            ...EMPTY_FORM,
            type: "list_source",
            outcome: { ...EMPTY_FORM.outcome, kind: outcome },
            listProvider: seed.listProvider,
            listId: seed.listId,
            collectionName: seed.collectionName,
            name: seed.collectionName,
          }
        : {
            ...EMPTY_FORM,
            type: "smart_filter",
            outcome: { ...EMPTY_FORM.outcome, kind: outcome },
            sections: seed.sections,
            smartFilter: seed.smartFilter as RuleFormState["smartFilter"],
          },
    );
    setIsEditing(false);
  }, [location.state]);

  function startEdit(rule: RuleRow) {
    const config = rule.config ?? {};
    const smartFilter = (config.smartFilter as SmartFilterGroup | undefined) ?? {
      kind: "group" as const,
      combinator: "all" as const,
      children: [],
    };
    // A preset leaves no trace in the saved rule — it is an ordinary smart
    // filter — so reopening one means recognising the shape it wrote. A tree
    // that has since been edited by hand simply doesn't match, and opens in
    // the full editor.
    const preset = outcomeFromConfig(config.action).kind === "cleanup" ? presetFromFilter(smartFilter) : null;
    setForm({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      cleanupPreset: preset?.preset.value,
      themes: (config.themes as string[]) || [],
      customThemes: (config.customThemes as string[]) || [],
      vibe: ((config.vibe as AiVibe) || "mixed") satisfies AiVibe,
      nameStyle: ((config.nameStyle as AiNameStyle) || "short_punchy") satisfies AiNameStyle,
      limit: (config.limit as number) ?? defaultLimitForType(rule.type),
      // Absent means "off" for grouped rules; ai_prompt keeps its 15 floor.
      minItems: (config.minItems as number) ?? (rule.type === "ai_prompt" ? 15 : 0),
      maxItems: (config.maxItems as number | undefined) ?? 30,
      aiFill: config.aiFill === "recommender" ? "recommender" : "llm",
      sections: (config.sections as string[]) || [],
      chart: (config.chart as string) || "top_250_movies",
      listId: (config.listId as string) || "",
      listProvider: ((config.listProvider as RuleFormState["listProvider"]) ||
        "mdblist") satisfies RuleFormState["listProvider"],
      collectionName: (config.collectionName as string) || "",
      smartFilter,
      filter: (config.filter as string) || "all",
      pinToHomepage: (config.pinToHomepage as boolean | undefined) ?? true,
      pinRotationCount: (config.pinRotationCount as number | undefined) ?? 0,
      pinMinItems: (config.pinMinItems as number | undefined) ?? 0,
      personalizable: config.personalizable === true,
      outcome: outcomeFromConfig(config.action),
      presentation: presentationFromConfig(config.presentation),
      schedule: scheduleFromConfig(config.schedule),
      arr: arrFormFromConfig(config.arr as RuleConfig["arr"], rule.type, (config.chart as string) || "top_250_movies"),
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
      config.maxItems = next.maxItems;
      // Absent is the LLM, so a rule that never chose keeps its behaviour.
      if (next.aiFill === "recommender") config.aiFill = "recommender";
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
      // Not where the wizard hides rotation: on a rule with at most one
      // collection per library it would change nothing but still be stored.
      if (next.pinToHomepage && next.pinRotationCount > 0 && rotatesPins(ruleCollectionCount(next.type, next.limit)))
        config.pinRotationCount = next.pinRotationCount;
      if (next.pinToHomepage && next.pinMinItems > 0) config.pinMinItems = next.pinMinItems;
      // Rebuilt from the form like everything else here, so a rule marked in
      // bulk keeps the mark through an edit rather than losing it to a config
      // that never mentioned it.
      if (next.personalizable) config.personalizable = true;

      // Written only when it says something other than the default, so a rule
      // that never visited the Look step stays byte-identical to how it was
      // stored before the step existed. A cleanup rule writes none of it: the
      // job neither describes nor illustrates its shelf.
      const p = next.presentation;
      const presentation: Record<string, unknown> = {};
      if (p.summary !== "template") presentation.summary = p.summary;
      if (p.summary === "custom" && p.customSummary.trim()) presentation.customSummary = p.customSummary.trim();
      if (p.poster !== "none") presentation.poster = p.poster;
      if (p.poster === "url" && p.posterUrl.trim()) presentation.posterUrl = p.posterUrl.trim();
      if (p.poster !== "none" && p.poster !== "url" && p.accentColor.trim()) {
        presentation.accentColor = p.accentColor.trim();
      }
      if (Object.keys(presentation).length > 0) config.presentation = presentation;
    }
    const arr = arrConfigFromForm(next.arr);
    if (arr) config.arr = arr;
    // Absent means "build a collection" — the same reading the job takes — so
    // a collection rule writes no action key at all and stays byte-identical
    // to how it was stored before this existed.
    if (next.outcome.kind === "cleanup") {
      const {
        kind: _kind,
        mode,
        consecutiveRuns,
        maxActionsPerRun,
        viaArr,
        addImportExclusion,
        dryRun,
        requireApproval,
      } = next.outcome;
      config.action = {
        kind: "cleanup",
        mode,
        consecutiveRuns,
        maxActionsPerRun,
        viaArr,
        addImportExclusion,
        dryRun,
        requireApproval,
      };
    }
    if (next.outcome.kind === "metadata") {
      const o = next.outcome;
      // Only the fields that say something are written. A blank input means
      // "leave this alone", and storing it as an empty string would make the
      // job plan a write that blanks the field instead.
      const set = Object.fromEntries(
        Object.entries(o.set)
          .map(([field, template]) => [field, template.trim()])
          .filter(([, template]) => template !== ""),
      );
      const addTags: Record<string, string[]> = {};
      if (o.addGenres.length > 0) addTags.genre = o.addGenres;
      if (o.addLabels.length > 0) addTags.label = o.addLabels;
      const removeTags: Record<string, string[]> = {};
      if (o.removeGenres.length > 0) removeTags.genre = o.removeGenres;
      if (o.removeLabels.length > 0) removeTags.label = o.removeLabels;

      config.action = {
        kind: "metadata",
        ...(Object.keys(set).length > 0 ? { set } : {}),
        ...(Object.keys(addTags).length > 0 ? { addTags } : {}),
        ...(Object.keys(removeTags).length > 0 ? { removeTags } : {}),
        lock: o.lock,
        overwriteLocked: o.overwriteLocked,
        maxWritesPerRun: o.maxWritesPerRun,
        sortLanguages: o.sortLanguages,
        dryRun: o.dryRun,
      };
    }
    if (next.outcome.kind === "playlist") {
      const o = next.outcome;
      config.action = {
        kind: "playlist",
        ...(o.playlistName.trim() ? { playlistName: o.playlistName.trim() } : {}),
        order: o.playlistOrder,
        combineSections: o.playlistCombineSections,
        ...(o.playlistLimit > 0 ? { limit: o.playlistLimit } : {}),
      };
    }
    const schedule = scheduleToConfig(next.schedule);
    if (schedule) config.schedule = schedule;

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

  /**
   * "Revert artwork", and honest about what that means.
   *
   * There is usually no image to put back: whatever was there before is a
   * Plex-generated mosaic Plex will regenerate on its own. What reverting
   * actually does is turn the rule's poster setting off and forget the ledger,
   * so nothing is uploaded again — and the confirmation says exactly that
   * rather than promising a restore.
   */
  function handleRevertArtwork(rule: RuleRow) {
    setPendingConfirm({
      message:
        `Stop generating artwork for "${rule.name}"?\n\n` +
        "The previous posters can't be restored; Plex's own mosaic returns after the next run.",
      onConfirm: () => {
        const config = { ...rule.config } as Record<string, unknown>;
        const presentation = { ...(config.presentation as Record<string, unknown> | undefined) };
        delete presentation.poster;
        delete presentation.posterUrl;
        if (Object.keys(presentation).length > 0) config.presentation = presentation;
        else delete config.presentation;

        updateMutation.mutate({ id: rule.id, config });
        revertArtworkMutation.mutate(
          { id: rule.id },
          {
            onSuccess: (result) =>
              addToast(
                result.forgotten > 0
                  ? `Stopped generating artwork for "${rule.name}" (${result.forgotten} collection(s) forgotten).`
                  : `Artwork generation is off for "${rule.name}".`,
                "success",
              ),
          },
        );
        setPendingConfirm(null);
      },
    });
  }

  /**
   * Offer the way back, once the thing has already happened.
   *
   * The confirmation dialog is still there, but it was never the real
   * protection — a prompt you see on every delete is a prompt you stop
   * reading. This is, and it says what it does and doesn't restore rather than
   * implying a fuller undo than it is.
   */
  function offerRestore(ids: string[]) {
    const what = ids.length === 1 ? "Rule deleted." : `${ids.length} rules deleted.`;
    addToast(what, "success", {
      action: {
        label: "Undo",
        onAction: () =>
          restoreMutation.mutate(
            { ids },
            {
              onSuccess: (res) => {
                utils.rules.list.invalidate();
                addToast(
                  res.missing > 0
                    ? `Restored ${res.restored}; ${res.missing} could not be. Collections are rebuilt on the next run.`
                    : `Restored ${res.restored === 1 ? "the rule" : `${res.restored} rules`}. Collections are rebuilt on the next run.`,
                  res.missing > 0 ? "info" : "success",
                );
              },
              onError: (err) => addToast(err.message, "error"),
            },
          ),
      },
    });
  }

  function handleDelete(rule: RuleRow) {
    setPendingConfirm({
      message: `Delete rule "${rule.name}"?`,
      onConfirm: () => {
        deleteMutation.mutate({ id: rule.id }, { onSuccess: () => offerRestore([rule.id]) });
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
        const deletedIds = [...selected];
        for (const id of deletedIds) {
          await deleteMutation.mutateAsync({ id });
        }
        setSelected(new Set());
        utils.rules.list.invalidate();
        // One offer for the whole batch: twelve toasts for twelve rules is
        // twelve chances to undo eleven of them by accident.
        offerRestore(deletedIds);
      },
    });
  }

  async function handleBulkEditApply(patch: BulkEditPatch) {
    setBulkEditOpen(false);
    const updated = new Set<string>();
    if (patch.limit !== undefined) {
      for (const rule of allRules.filter((r) => selected.has(r.id) && typeHasLimit(r.type))) {
        await updateMutation.mutateAsync({ id: rule.id, config: { ...rule.config, limit: patch.limit } });
        updated.add(rule.id);
      }
    }
    // After the limit pass, and server-side: it reads each rule fresh, so the
    // config written above isn't overwritten with the stale copy held here.
    if (patch.personalizable !== undefined) {
      const ids = allRules
        .filter((r) => selected.has(r.id) && isPersonalizableAction((r.config ?? {}) as { action?: RuleAction }))
        .map((r) => r.id);
      if (ids.length > 0) {
        await setPersonalizableMutation.mutateAsync({ ids, personalizable: patch.personalizable });
        for (const id of ids) updated.add(id);
      }
    }
    utils.rules.list.invalidate();
    addToast(`Updated ${updated.size} rule${updated.size !== 1 ? "s" : ""}`, "success");
  }

  async function handleBulkSetEnabled(enabled: boolean) {
    for (const id of selected) {
      await updateMutation.mutateAsync({ id, enabled });
    }
    utils.rules.list.invalidate();
    addToast(`${enabled ? "Enabled" : "Disabled"} ${selected.size} rule${selected.size !== 1 ? "s" : ""}`, "success");
  }

  /**
   * Bulk actions queue rather than await.
   *
   * The server runs manual rules one at a time, and each rule's row says
   * whether it is queued, running or done — so the browser no longer has to
   * hold the sequence together, and closing the tab no longer abandons it.
   */
  async function handleBulkRun() {
    const ids = Array.from(selected);
    for (const id of ids) await runRule(id).catch(() => {});
    addToast(`Queued ${ids.length} rule${ids.length !== 1 ? "s" : ""} to run`, "info");
  }

  async function handleBulkTest() {
    const ids = Array.from(selected);
    for (const id of ids) await testRule(id).catch(() => {});
    addToast(`Queued ${ids.length} rule${ids.length !== 1 ? "s" : ""} to test`, "info");
  }

  /**
   * Runs this tab started, so it can report their endings.
   *
   * A run is now visible to every tab, but only the tab that pressed the button
   * should toast about it or swing the preview row open. Keyed by run id rather
   * than rule id: attaching to a run someone else started shouldn't claim it.
   */
  const startedHereRef = useRef<Set<string>>(new Set());

  function testRule(id: string): Promise<unknown> {
    // expandedRow drives both the in-flight log view and the post-completion
    // test-results preview, so we leave it set on success.
    setExpandedRow(id);
    setExpandedPreview(null);
    return testMutation.mutateAsync({ id }).then((res) => {
      startedHereRef.current.add(res.runId);
      // Don't wait 2s for the next poll to admit the run exists.
      utils.rules.activeRuns.invalidate();
      return res;
    });
  }

  function runRule(id: string): Promise<unknown> {
    // While the run is in-flight, expandedRow drives the inline log view. On
    // completion the watcher below collapses it and opens the preview row.
    setExpandedRow(id);
    setExpandedPreview(null);
    return runMutation.mutateAsync({ id }).then((res) => {
      startedHereRef.current.add(res.runId);
      if (res.attached) addToast("That rule is already running — showing the run in progress.", "info");
      utils.rules.activeRuns.invalidate();
      return res;
    });
  }

  /**
   * Notice runs ending.
   *
   * The mutation returns as soon as the run has a row, so there is no promise
   * to hang the "it finished" behaviour off any more. A run that leaves the
   * active list has ended — however it ended, and whichever tab or process was
   * executing it.
   */
  const previouslyActiveRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const data = activeRunsQuery.data;
    if (!data) return;
    const nowActive = new Map(data.map((run) => [run.ruleId, run.id]));

    for (const [ruleId, runId] of previouslyActiveRef.current) {
      if (nowActive.get(ruleId) === runId) continue;
      utils.rules.list.invalidate();
      utils.rules.lastTestResult.invalidate({ id: ruleId });
      if (!startedHereRef.current.delete(runId)) continue;

      void utils.client.rules.runDetail.query({ runId }).then((run) => {
        if (!run) return;
        const name = allRules.find((r) => r.id === ruleId)?.name ?? "rule";
        if (run.status === "cancelled") {
          setExpandedRow((prev) => (prev === ruleId ? null : prev));
          return;
        }
        if (run.status === "error") {
          // The status cell carries the message in its tooltip; the log view
          // shouldn't sit there looking live.
          setExpandedRow((prev) => (prev === ruleId ? null : prev));
          addToast(`"${name}" failed — ${run.error ?? "see the run log"}`, "error");
          return;
        }
        if (run.phase === "test") return;

        const created = (run.collectionCount ?? 0) > 0;
        addToast(`Ran "${name}"${created ? "" : " (no collections created)"}`, "success");
        // Swap the in-flight log view for the result preview. With nothing
        // created there's nothing to preview, so just collapse.
        setExpandedRow((prev) => (prev === ruleId ? null : prev));
        if (created) setExpandedPreview(ruleId);
      });
    }
    previouslyActiveRef.current = nowActive;
    // `allRules` is read for a display name only; re-running this on every
    // list refetch would replay endings that were already handled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunsQuery.data]);

  function handleTest(rule: RuleRow) {
    void testRule(rule.id).catch(() => {
      // error captured per-row; mutation state is also reset on next test
    });
  }

  function handleRun(rule: RuleRow) {
    void runRule(rule.id).catch(() => {});
  }

  /**
   * Stop a run. Cancelling is a message to the run, not to this tab: the
   * executor unwinds and writes the terminal status itself, which is what makes
   * it work for a run belonging to another process.
   */
  function handleCancel(ruleId: string) {
    const active = activeByRule.get(ruleId);
    if (!active) return;
    cancelRunMutation.mutate({ runId: active.id }, { onSuccess: () => utils.rules.activeRuns.invalidate() });
  }

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
      <ConflictsBanner
        onOpenRule={(ruleId) => {
          // The unfiltered list: a conflict can name a cleanup rule while
          // this page is showing collection rules, and that one should open too.
          const rule = ((rulesQuery.data ?? []) as RuleRow[]).find((r) => r.id === ruleId);
          if (rule) startEdit(rule);
        }}
      />

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
            // No "something is already running" guard any more: starting a run
            // is now just enqueuing one, and the queue is the thing that keeps
            // them from overlapping.
            { label: "Test", onClick: handleBulkTest },
            { label: "Run", tone: "primary", onClick: handleBulkRun },
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
        <EmptyState
          icon="cog"
          title={
            outcome === "cleanup"
              ? "No cleanup rules yet"
              : outcome === "metadata"
                ? "No metadata rules yet"
                : "No rules yet"
          }
          description={
            outcome === "cleanup"
              ? "Matches queue for several runs before anything is removed."
              : outcome === "metadata"
                ? "Every run is previewed first and can be undone."
                : undefined
          }
          action={
            <button type="button" className={shared.button} onClick={startCreate}>
              New rule
            </button>
          }
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon="cog"
          title="No matching rules"
          action={
            <button
              type="button"
              className={shared.buttonSecondary}
              onClick={() => setParams({ q: "", type: "", enabled: "" })}
            >
              Clear filters
            </button>
          }
        />
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
                <SortableTh sortKey="order" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  {/* The running order is a column so it can be sorted by,
                      which is the only state in which dragging makes sense. */}
                  Order
                </SortableTh>
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
                <SortableTh sortKey="runs" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Runs
                </SortableTh>
                <th>Config</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const active = activeByRule.get(rule.id);
                const isTesting = active?.phase === "test";
                const isRunning = active?.phase === "run";
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
                    historyExpanded={expandedHistory === rule.id}
                    onToggleHistory={() => setExpandedHistory((id) => (id === rule.id ? null : rule.id))}
                    formActive={!!form}
                    activeRunId={active?.id ?? null}
                    runProgress={active?.progress ?? 0}
                    createPending={createMutation.isPending}
                    onRun={() => handleRun(rule)}
                    onCancelRun={() => handleCancel(rule.id)}
                    onTest={() => handleTest(rule)}
                    resolveTag={resolveTag}
                    cleanup={cleanupCounts[rule.id]}
                    isMetadata={outcome === "metadata"}
                    onCancelTest={() => handleCancel(rule.id)}
                    runsHref={runsHref(rule.id)}
                    onEdit={() => startEdit(rule)}
                    onDuplicate={() => handleDuplicate(rule)}
                    onDelete={() => handleDelete(rule)}
                    generatesArtwork={generatesArtwork(rule)}
                    onRevertArtwork={() => handleRevertArtwork(rule)}
                    onDetailCleared={() => setExpandedRow(null)}
                    canReorder={canReorder}
                    orderIndex={orderIndexById.get(rule.id) ?? 0}
                    isDragging={dragId === rule.id}
                    onDragStart={() => setDragId(rule.id)}
                    onDragEnd={() => setDragId(null)}
                    onDropOn={() => handleDrop(rule.id)}
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

      {outcome === "collection" && hiddenMetadataCount > 0 && (
        <p className={styles.otherOutcomeHint}>
          <Link to="/metadata">
            {hiddenMetadataCount} metadata rule{hiddenMetadataCount === 1 ? "" : "s"}
          </Link>{" "}
          {hiddenMetadataCount === 1 ? "lives" : "live"} on the Metadata page.
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
          limitEligibleCount={allRules.filter((r) => selected.has(r.id) && typeHasLimit(r.type)).length}
          personalizableEligibleCount={
            allRules.filter(
              (r) => selected.has(r.id) && isPersonalizableAction((r.config ?? {}) as { action?: RuleAction }),
            ).length
          }
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
