import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import DropdownButton from "#/DropdownButton";
import ConfirmModal from "#/ConfirmModal";
import RuleWizard, { type RuleFormState, type AiVibe, type AiNameStyle, DEFAULT_ARR_FORM } from "#/RuleWizard";
import { RulesSkeleton } from "#/Skeleton";
import Spinner from "#/Spinner";
import EmptyState from "#/EmptyState";
import RelativeTime from "#/RelativeTime";
import ToggleSwitch from "#/ToggleSwitch";
import { useToast } from "#/Toast";
import shared from "./Collections.module.css";
import styles from "./Rules.module.css";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSecs = Math.round(s % 60);
  return `${mins}m ${remSecs}s`;
}

const RULE_TYPES = [
  { value: "ai_prompt", label: "AI Prompt" },
  { value: "top_rated", label: "Top Rated" },
  { value: "lowest_rated", label: "Lowest Rated" },
  { value: "actors", label: "Actors" },
  { value: "directors", label: "Directors" },
  { value: "studios", label: "Studios" },
  { value: "networks", label: "Networks" },
  { value: "genres", label: "Genres" },
  { value: "countries", label: "Countries" },
  { value: "content_ratings", label: "Content Ratings" },
  { value: "imdb_chart", label: "IMDb Chart" },
  { value: "imdb_list", label: "IMDb List" },
  { value: "list_source", label: "List Source" },
  { value: "rt_top_rated", label: "RT Top Rated" },
  { value: "seerr_requests", label: "Seerr Requests" },
  { value: "tmdb_popular_actors", label: "Popular Actors" },
  { value: "tmdb_popular_directors", label: "Popular Directors" },
  { value: "tmdb_franchises", label: "Franchises" },
  { value: "decades", label: "Decades" },
  { value: "years", label: "Years" },
  { value: "resolutions", label: "Resolutions" },
  { value: "audio_languages", label: "Audio Languages" },
  { value: "subtitle_languages", label: "Subtitle Languages" },
  { value: "video_formats", label: "Video Formats" },
  { value: "streaming", label: "Streaming" },
  { value: "based_on", label: "Based On" },
  { value: "seasonal", label: "Seasonal" },
  { value: "awards", label: "Awards" },
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
  list_source: (c) => `${(c.listProvider as string) || "?"}: ${(c.listId as string) || "—"}`,
  rt_top_rated: (c) => `Top ${c.limit ?? 100} items`,
  seerr_requests: (c) => `${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"} | ${c.limit ?? 50} items`,
};

const CONFIG_DETAILS: Record<string, (c: Record<string, unknown>) => string> = {
  ai_prompt: (c) => {
    const themes = (c.themes as string[] | undefined) ?? [];
    const custom = ((c.customThemes as string[] | undefined) ?? []).filter((t) => t.trim().length > 0);
    const all = [...themes, ...custom];
    const lines = [
      `Vibe: ${(c.vibe as string) ?? "mixed"}`,
      `Name style: ${(c.nameStyle as string) ?? "short_punchy"}`,
      `Collections per section: up to ${c.limit ?? 8}`,
      `Min items per collection: ${c.minItems ?? 15}`,
      "",
      `Themes (${all.length}):`,
      ...(all.length ? all.map((t) => `  • ${t}`) : ["  (none)"]),
    ];
    return lines.join("\n");
  },
  imdb_chart: (c) => `Chart: ${IMDB_CHART_LABELS[c.chart as string] || c.chart || "—"}`,
  imdb_list: (c) => `List ID: ${c.listId || "—"}`,
  list_source: (c) => {
    const lines = [`Provider: ${(c.listProvider as string) || "—"}`, `List: ${(c.listId as string) || "—"}`];
    if (c.collectionName) lines.push(`Name: ${c.collectionName as string}`);
    return lines.join("\n");
  },
  seerr_requests: (c) =>
    `Filter: ${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"}\nLimit: ${c.limit ?? 50}`,
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
  listProvider: "mdblist",
  collectionName: "",
  filter: "all",
  pinToHomepage: true,
  arr: { ...DEFAULT_ARR_FORM },
};

function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  return 10;
}

function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list" && type !== "list_source";
}

type SortKey = "name" | "type" | "lastRun";
type EnabledFilter = "all" | "enabled" | "disabled";

type RuleRow = {
  id: string;
  name: string;
  type: string;
  enabled: number;
  config: Record<string, unknown> | null;
  createdAt: number;
  lastCollectionRatingKey: string | null;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunCollectionCount: number | null;
  lastRunItemCount: number | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastTestAt: number | null;
  lastTestDurationMs: number | null;
  lastTestCollectionCount: number | null;
  lastTestItemCount: number | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  hasTestResult: boolean;
};

interface RuleStatusCellProps {
  rule: RuleRow;
  isTesting: boolean;
  isRunning: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
}

function StatusCell({ rule, isTesting, isRunning, expanded, expandable, onToggle }: RuleStatusCellProps) {
  if (isRunning) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Running…
      </span>
    );
  }
  if (isTesting) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Testing…
      </span>
    );
  }

  // Idle — show most recent of run / test
  const runAt = rule.lastRunAt ?? 0;
  const testAt = rule.lastTestAt ?? 0;
  const useRun = runAt >= testAt;
  const stamp = useRun ? rule.lastRunAt : rule.lastTestAt;
  const status = useRun ? rule.lastRunStatus : rule.lastTestStatus;
  const error = useRun ? rule.lastRunError : rule.lastTestError;
  const label = useRun ? "Run" : "Test";

  if (!stamp) {
    return <span className={styles.statusIdle}>—</span>;
  }

  const summary = useRun
    ? rule.lastRunStatus === "ok"
      ? "ok"
      : rule.lastRunStatus
    : rule.lastTestStatus === "ok"
      ? `${rule.lastTestCollectionCount ?? 0} collection${rule.lastTestCollectionCount === 1 ? "" : "s"}`
      : rule.lastTestStatus;

  let cls = styles.statusOk;
  if (status === "error") cls = styles.statusError;
  else if (status === "cancelled") cls = styles.statusCancelled;

  const body = (
    <span>
      {label} <RelativeTime timestamp={stamp} /> · {summary}
    </span>
  );

  if (!expandable) {
    return (
      <span className={`${styles.statusInline} ${cls}`} title={error || undefined}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${styles.statusInline} ${styles.statusToggle} ${cls}`}
      title={error || `${label} — click to ${expanded ? "hide" : "show"} details`}
      aria-expanded={expanded}
    >
      <span className={styles.chevron} aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
      {body}
    </button>
  );
}

interface InlineProgressProps {
  ruleId: string;
  phase: "test" | "run";
}

function InlineProgress({ ruleId, phase }: InlineProgressProps) {
  const progressQuery = trpc.rules.progress.useQuery({ id: ruleId }, { refetchInterval: 500, enabled: true });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const data = progressQuery.data;
  const elapsed = data ? now - data.startedAt : 0;
  const pct = data && data.total > 0 ? Math.min(100, Math.round((data.current / data.total) * 100)) : 0;
  const indeterminate = !data || data.total === 0 || data.current === 0;

  return (
    <div>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>{phase === "test" ? "Testing" : "Running"}…</span>
        <span className={styles.detailMeta}>
          {elapsed > 0 ? `${formatDuration(elapsed)} elapsed` : ""}
          {data && data.total > 0 ? ` · step ${data.current}/${data.total}` : ""}
        </span>
      </div>
      <div className={styles.progressBar}>
        {indeterminate ? (
          <div className={styles.progressBarIndeterminate} />
        ) : (
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className={styles.progressMessage}>{data?.message || "Starting…"}</div>
      {data && data.recentLogs.length > 0 && (
        <pre className={styles.logTail}>{data.recentLogs.slice(-8).join("\n")}</pre>
      )}
    </div>
  );
}

interface RuleDetailRowProps {
  ruleId: string;
  isTesting: boolean;
  isRunning: boolean;
  errorToShow: string | null;
  onCleared: () => void;
}

function RuleDetailRow({ ruleId, isTesting, isRunning, errorToShow, onCleared }: RuleDetailRowProps) {
  const resultQuery = trpc.rules.lastTestResult.useQuery({ id: ruleId }, { enabled: !isRunning });
  const hasResult = !!resultQuery.data;
  const showAnything = isTesting || isRunning || !!errorToShow || hasResult;
  if (!showAnything) return null;

  return (
    <tr className={styles.detailRow}>
      <td colSpan={7}>
        <div className={styles.detailWrap}>
          {(isTesting || isRunning) && <InlineProgress ruleId={ruleId} phase={isTesting ? "test" : "run"} />}
          {!isTesting && !isRunning && errorToShow && (
            <div style={{ marginBottom: 12 }}>
              <div className={styles.detailHeader}>
                <span className={styles.detailTitle}>Last error</span>
              </div>
              <div className={styles.errorBox}>{errorToShow}</div>
            </div>
          )}
          {!isRunning && <TestResultsBlock ruleId={ruleId} onCleared={onCleared} />}
        </div>
      </td>
    </tr>
  );
}

interface TestResultsBlockProps {
  ruleId: string;
  onCleared?: () => void;
}

function TestResultsBlock({ ruleId, onCleared }: TestResultsBlockProps) {
  const utils = trpc.useUtils();
  const resultQuery = trpc.rules.lastTestResult.useQuery({ id: ruleId });
  const clearMutation = trpc.rules.clearTestResult.useMutation({
    onSuccess: () => {
      utils.rules.lastTestResult.invalidate({ id: ruleId });
      utils.rules.list.invalidate();
      onCleared?.();
    },
  });
  const result = resultQuery.data;
  if (!result) return null;
  const totalItems = result.collections.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>Test results</span>
        <button
          type="button"
          className={styles.testPreviewCloseBtn}
          onClick={() => clearMutation.mutate({ id: ruleId })}
        >
          Clear
        </button>
      </div>
      <div className={styles.detailTestSummary}>
        <span>
          <strong>{result.collections.length}</strong> collection{result.collections.length !== 1 ? "s" : ""}
        </span>
        <span>
          <strong>{totalItems}</strong> item{totalItems !== 1 ? "s" : ""}
        </span>
        <span>
          <strong>{formatDuration(result.durationMs)}</strong>
        </span>
        {(result.tokensIn || result.tokensOut) && (
          <span>
            tokens: <strong>{result.tokensIn ?? 0}</strong> in / <strong>{result.tokensOut ?? 0}</strong> out
          </span>
        )}
      </div>
      {result.collections.length === 0 ? (
        <div className={styles.testPreviewEmpty}>No collections would be created by this rule.</div>
      ) : (
        result.collections.map((col, i) => (
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
  );
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

  const runMutation = trpc.rules.run.useMutation();
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filters / sort / search
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Per-row UI state — persisted across refresh in sessionStorage
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

  // Cancel test/run on unmount
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

  // Keyboard shortcuts: 'n' opens new-rule wizard
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
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.search}
              placeholder="Search rules…  (press / to focus)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`${styles.filterChip} ${typeFilter === "all" ? styles.filterChipActive : ""}`}
            onClick={() => setTypeFilter("all")}
          >
            All types
          </button>
          {presentTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.filterChip} ${typeFilter === t ? styles.filterChipActive : ""}`}
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABELS[t] || t}
            </button>
          ))}
          <span className={styles.filterDivider} />
          <div className={styles.segmented} role="tablist">
            <button
              type="button"
              className={`${styles.segmentedBtn} ${enabledFilter === "all" ? styles.segmentedBtnActive : ""}`}
              onClick={() => setEnabledFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`${styles.segmentedBtn} ${enabledFilter === "enabled" ? styles.segmentedBtnActive : ""}`}
              onClick={() => setEnabledFilter("enabled")}
            >
              Enabled
            </button>
            <button
              type="button"
              className={`${styles.segmentedBtn} ${enabledFilter === "disabled" ? styles.segmentedBtnActive : ""}`}
              onClick={() => setEnabledFilter("disabled")}
            >
              Disabled
            </button>
          </div>
          <select
            className={styles.sortSelect}
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
              setSortKey(k);
              setSortDir(d);
            }}
            aria-label="Sort rules"
          >
            <option value="name:asc">Name (A→Z)</option>
            <option value="name:desc">Name (Z→A)</option>
            <option value="type:asc">Type (A→Z)</option>
            <option value="lastRun:desc">Last run (recent first)</option>
            <option value="lastRun:asc">Last run (oldest first)</option>
          </select>
        </div>
      )}

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span>
            {selected.size} rule{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button
            className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
            onClick={() => handleBulkSetEnabled(true)}
            disabled={updateMutation.isPending}
          >
            Enable
          </button>
          <button
            className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
            onClick={() => handleBulkSetEnabled(false)}
            disabled={updateMutation.isPending}
          >
            Disable
          </button>
          <button
            className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
            onClick={handleBulkTest}
            disabled={testMutation.isPending || runMutation.isPending}
          >
            Test
          </button>
          <button
            className={`${shared.button} ${shared.buttonSmall}`}
            onClick={handleBulkRun}
            disabled={testMutation.isPending || runMutation.isPending}
          >
            Run
          </button>
          <button className={`${shared.buttonDanger} ${shared.buttonSmall}`} onClick={handleBulkDelete}>
            Delete
          </button>
          <span className={styles.bulkSpacer} />
          <button className={`${shared.buttonSecondary} ${shared.buttonSmall}`} onClick={() => setSelected(new Set())}>
            Cancel
          </button>
        </div>
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
                const c = rule.config ?? {};
                let configSummary = CONFIG_SUMMARY[rule.type]?.(c) ?? `Max: ${(c as { limit?: number }).limit ?? 10}`;
                const sections = (c as { sections?: string[] }).sections;
                if (sections?.length) configSummary += ` | Sections: ${sections.join(", ")}`;

                const typeBadge = TYPE_BADGE[rule.type] ?? styles.typeCriteria;
                const isTesting = testMutation.isPending && testingRuleId === rule.id;
                const isRunning = runMutation.isPending && runningRuleId === rule.id;
                const isExpanded = expandedRow === rule.id;
                const configDetail = CONFIG_DETAILS[rule.type]?.(c);
                const showConfigDetails = expandedConfig.has(rule.id) && configDetail;
                const errorToShow =
                  rule.lastRunAt && rule.lastRunStatus === "error"
                    ? rule.lastRunError
                    : rule.lastTestStatus === "error"
                      ? rule.lastTestError
                      : null;
                const expandable = !!errorToShow || rule.hasTestResult;
                const showDetail = isTesting || isRunning || (isExpanded && expandable);

                return (
                  <Fragment key={rule.id}>
                    <tr>
                      <td className={styles.checkboxCell}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${rule.name}`}
                          checked={selected.has(rule.id)}
                          onChange={() => handleCheckboxClick(i, { shiftKey: false })}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault();
                              handleCheckboxClick(i, { shiftKey: true });
                            }
                          }}
                        />
                      </td>
                      <td>{rule.name}</td>
                      <td>
                        <span className={`${styles.typeLabel} ${typeBadge}`}>
                          {TYPE_LABELS[rule.type] || rule.type}
                        </span>
                      </td>
                      <td className={styles.toggleCell}>
                        <ToggleSwitch checked={!!rule.enabled} onChange={() => handleToggle(rule)} size="sm" />
                      </td>
                      <td className={styles.statusCell}>
                        <StatusCell
                          rule={rule}
                          isTesting={isTesting}
                          isRunning={isRunning}
                          expanded={isExpanded}
                          expandable={expandable}
                          onToggle={() => toggleRowExpand(rule.id)}
                        />
                      </td>
                      <td>
                        <span
                          className={`${styles.configSummary} ${configDetail ? styles.configSummaryWrap : ""}`}
                          onClick={() => configDetail && toggleConfigExpand(rule.id)}
                          title={configDetail ? "Click to expand" : undefined}
                        >
                          {configSummary}
                        </span>
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {rule.lastCollectionRatingKey &&
                            ((rule.lastRunCollectionCount ?? 0) > 1 ? (
                              <button
                                className={styles.actionBtn}
                                onClick={() => navigate(`/collections?label=${encodeURIComponent(`Rule:${rule.id}`)}`)}
                                title={`View ${rule.lastRunCollectionCount} collections from this rule`}
                              >
                                View
                              </button>
                            ) : (
                              <button
                                className={styles.actionBtn}
                                onClick={() => navigate(`/collections/${rule.lastCollectionRatingKey}`)}
                                title="View last generated collection"
                              >
                                View
                              </button>
                            ))}
                          {isRunning ? (
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={handleCancelRun}
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                              onClick={() => handleRun(rule)}
                              disabled={runMutation.isPending || testMutation.isPending}
                              title={
                                runMutation.isPending || testMutation.isPending
                                  ? "Another rule is running"
                                  : "Generate collections in Plex"
                              }
                            >
                              Run
                            </button>
                          )}
                          {isTesting ? (
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={handleCancelTest}
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              className={styles.actionBtn}
                              onClick={() => handleTest(rule)}
                              disabled={testMutation.isPending || runMutation.isPending}
                              title={
                                testMutation.isPending || runMutation.isPending
                                  ? "Another rule is running"
                                  : "Preview without writing to Plex"
                              }
                            >
                              Test
                            </button>
                          )}
                          <span className={styles.actionsDivider} />
                          <button
                            className={styles.actionBtn}
                            onClick={() => startEdit(rule)}
                            disabled={!!form}
                            title="Edit rule"
                          >
                            Edit
                          </button>
                          <button
                            className={styles.actionBtn}
                            onClick={() => handleDuplicate(rule)}
                            disabled={createMutation.isPending}
                            title="Duplicate rule"
                          >
                            Duplicate
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            onClick={() => handleDelete(rule)}
                            title="Delete rule"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {showConfigDetails && (
                      <tr>
                        <td colSpan={7} className={styles.detailRow}>
                          <div style={{ padding: "0 18px 12px 56px" }}>
                            <pre className={styles.configDetails}>{configDetail}</pre>
                          </div>
                        </td>
                      </tr>
                    )}
                    {showDetail && (
                      <RuleDetailRow
                        ruleId={rule.id}
                        isTesting={isTesting}
                        isRunning={isRunning}
                        errorToShow={errorToShow}
                        onCleared={() => setExpandedRow(null)}
                      />
                    )}
                  </Fragment>
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

function MigrationBanner() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const status = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const dismiss = trpc.migration.dismiss.useMutation();

  if (!status.data?.shouldShowBanner) return null;
  const actionable = status.data.providers.filter((p) => p.shouldShowBanner);
  const count = actionable.reduce((sum, p) => sum + p.count, 0);
  const labels = actionable.map((p) => p.label);
  const labelText =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;

  const handleDismiss = async () => {
    await Promise.all(actionable.map((p) => dismiss.mutateAsync({ providerId: p.id })));
    await utils.migration.status.invalidate();
  };

  return (
    <div
      style={{
        margin: "0 0 16px 0",
        padding: "12px 16px",
        background: "rgba(74, 108, 247, 0.08)",
        border: "1px solid rgba(74, 108, 247, 0.3)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ flex: 1 }}>
        Tinkerbell can migrate <strong>{count}</strong> {labelText}-managed collection{count === 1 ? "" : "s"} into
        Tinkerbell rules.
      </div>
      <button
        type="button"
        onClick={() => navigate("/settings/migrate")}
        style={{
          padding: "6px 14px",
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Review
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          padding: "6px 14px",
          background: "transparent",
          color: "var(--color-muted, #888)",
          border: "1px solid var(--border-input)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
