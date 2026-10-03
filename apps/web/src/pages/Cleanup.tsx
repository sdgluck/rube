import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { EMPTY, formatFileSize } from "#/format";
import BulkBar from "#components/BulkBar";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import MultiSelect from "#components/MultiSelect";
import PageShell, { StatusChip } from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import SearchInput from "#components/SearchInput";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";
import { useToast } from "#components/Toast";
import type { RuleSeed } from "#/lib/ruleSeed";
import sharedStyles from "#/styles/shared.module.css";
import styles from "./Cleanup.module.css";

/**
 * The cleanup queue — everything a cleanup rule has its eye on, across rules.
 *
 * This page is the reason the streak exists. A rule that deletes files on a
 * schedule is only acceptable if there is somewhere to see what it is about to
 * do while there is still time to say no, and "Keep" is that no.
 *
 * It is also the one screen in the app where a mis-click costs a file, so it
 * gets the tools a list needs to actually be read rather than skimmed: search,
 * filters, sort, a batch reprieve, and an undo on every reprieve.
 *
 * Still no "action this now" button. Everything else about a cleanup rule is
 * edited on the rule itself, and short-circuiting the waiting period from the
 * page whose whole purpose is oversight would defeat the design.
 */

const MODE_LABELS: Record<string, string> = {
  collection_only: "Queue only",
  label: "Label",
  unmonitor: "Unmonitor",
  delete: "Delete",
};

/** Separate from MODE_LABELS: suffixing "ed" gives "Deleteed", "Queue onlyed". */
const MODE_PAST_LABELS: Record<string, string> = {
  collection_only: "Queued",
  label: "Labelled",
  unmonitor: "Unmonitored",
  delete: "Deleted",
};

/** Modes that remove or change something outside Tinkerbell's bookkeeping. */
const DESTRUCTIVE = new Set(["unmonitor", "delete"]);

/**
 * How long a reprieve lasts. Never "forever": an indefinite hold is
 * indistinguishable from the rule being wrong, and this way the item comes back
 * for review rather than silently never being considered again.
 */
const HOLD_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "A year" },
];

/** An empty smart filter: the wizard opened as its own "New rule" would. */
const NEW_CLEANUP_RULE: RuleSeed = {
  kind: "smart_filter",
  sections: [],
  smartFilter: { kind: "group", combinator: "all", children: [] },
  dropped: [],
};

const STATUS_FILTERS = ["all", "due", "awaitingApproval", "waiting", "held"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  due: "Due next run",
  waiting: "Waiting",
  held: "Held",
  awaitingApproval: "Awaiting approval",
};

type QueueRow = {
  ruleId: string;
  ruleName: string;
  ratingKey: string;
  title: string;
  mode: string;
  action: string;
  streak: number;
  consecutiveRuns: number;
  runsRemaining: number;
  held: boolean;
  heldUntil: number | null;
  actionedAt: number | null;
  lastMatchedAt: number;
  /** Null where the size isn't known — shows, and items not yet synced. */
  fileSize: number | null;
  /** A standing protection covers this item; no rule will ever action it. */
  isProtected: boolean;
  /** Portal users who have asked for this to stay. Advisory, not a hold. */
  keepVotes: string[];
  /** This rule holds destructive actions until a human says yes to each item. */
  requiresApproval: boolean;
  approved: boolean;
};

export default function Cleanup() {
  const [showActioned, setShowActioned] = useState(false);
  const [search, setSearch] = useState("");
  const [ruleFilter, setRuleFilter] = useState<string[]>([]);
  const [modeFilter, setModeFilter] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [holdDays, setHoldDays] = useState(90);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { addToast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const query = trpc.cleanup.queue.useQuery(
    { includeActioned: showActioned },
    { refetchOnWindowFocus: false, refetchInterval: 30_000 },
  );
  const invalidate = () => {
    utils.cleanup.queue.invalidate();
    utils.nav.metrics.invalidate();
  };
  const holdMutation = trpc.cleanup.hold.useMutation({ onSuccess: invalidate });
  const holdManyMutation = trpc.cleanup.holdMany.useMutation({ onSuccess: invalidate });
  const restoreMutation = trpc.cleanup.restoreHolds.useMutation({ onSuccess: invalidate });
  const approveMutation = trpc.cleanup.approve.useMutation({ onSuccess: invalidate });
  const protectMutation = trpc.cleanup.protect.useMutation({
    onSuccess: () => {
      invalidate();
      utils.cleanup.protections.invalidate();
    },
  });
  const unprotectMutation = trpc.cleanup.unprotect.useMutation({
    onSuccess: () => {
      invalidate();
      utils.cleanup.protections.invalidate();
    },
  });

  const rows = (query.data ?? []) as QueueRow[];
  // A held item is explicitly not due, however long its streak. `held` comes
  // from the server so this can't disagree with what the engine will do.
  // Approval-gated rows that nobody has approved are not due: the next run
  // will log them and move on. Counting them here would put a number in the
  // header that no run will act on.
  const dueNow = rows.filter(
    (r) =>
      r.actionedAt == null && r.runsRemaining === 0 && !r.held && !r.isProtected && (!r.requiresApproval || r.approved),
  );

  const ruleOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of rows) names.set(row.ruleId, row.ruleName);
    return [...names.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const modeOptions = useMemo(() => {
    const modes = new Set(rows.map((r) => r.mode));
    return [...modes].map((value) => ({ value, label: MODE_LABELS[value] ?? value }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !row.title.toLowerCase().includes(needle)) return false;
      if (ruleFilter.length > 0 && !ruleFilter.includes(row.ruleId)) return false;
      if (modeFilter.length > 0 && !modeFilter.includes(row.mode)) return false;
      if (status === "due") return row.actionedAt == null && row.runsRemaining === 0 && !row.held && !row.isProtected;
      if (status === "awaitingApproval") {
        return row.actionedAt == null && row.requiresApproval && !row.approved && row.runsRemaining === 0 && !row.held;
      }
      if (status === "waiting") return row.actionedAt == null && row.runsRemaining > 0 && !row.held;
      if (status === "held") return row.actionedAt == null && row.held;
      return true;
    });
  }, [rows, search, ruleFilter, modeFilter, status]);

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: filtered,
    accessors: {
      title: (r: QueueRow) => r.title,
      rule: (r: QueueRow) => r.ruleName,
      action: (r: QueueRow) => r.mode,
      // Closest to being actioned first — the only ordering that matters when
      // you are deciding what to rescue.
      streak: (r: QueueRow) => r.runsRemaining,
      lastMatched: (r: QueueRow) => r.lastMatchedAt,
      // Unknown sizes sort as -1 so "biggest first" does not open with a run
      // of items whose size nobody knows.
      size: (r: QueueRow) => r.fileSize ?? -1,
    },
    defaultKey: "streak",
    defaultDir: "asc",
    descFirst: ["lastMatched", "size"],
  });

  const rowKey = (row: QueueRow) => `${row.ruleId}:${row.ratingKey}`;
  // Actioned rows are history: there is nothing left to keep or release.
  const selectable = sorted.filter((r) => r.actionedAt == null);
  const selectedRows = selectable.filter((r) => selected.has(rowKey(r)));

  function toggleRow(row: QueueRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Apply a reprieve to the selection, and offer to take it back.
   *
   * The undo restores each item's *previous* hold rather than clearing them
   * all: some of the selection may already have been held, and "undo" that
   * released them would be a worse outcome than the mis-click it was fixing.
   */
  function bulkHold(days: number | null) {
    const items = selectedRows.map((r) => ({ ruleId: r.ruleId, ratingKey: r.ratingKey }));
    if (items.length === 0) return;
    holdManyMutation.mutate(
      { items, days },
      {
        onSuccess: (res) => {
          setSelected(new Set());
          addToast(
            days == null
              ? `${res.count} item${res.count === 1 ? "" : "s"} back in the queue.`
              : `Keeping ${res.count} item${res.count === 1 ? "" : "s"} for ${days} days.`,
            "success",
            {
              action: {
                label: "Undo",
                onAction: () =>
                  restoreMutation.mutate(
                    { items: res.previous },
                    { onSuccess: () => addToast("Put back as it was.", "success") },
                  ),
              },
            },
          );
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  /**
   * Settle it for good.
   *
   * No confirm: protecting something is the safe direction, and the row grows
   * a Remove on the Protected tab the moment it lands.
   */
  function protect(row: QueueRow) {
    protectMutation.mutate(
      { kind: "item", value: row.ratingKey, label: row.title, note: "" },
      {
        onSuccess: () =>
          addToast(`Protected "${row.title}"`, "success", {
            action: { label: "Undo", onAction: () => void unprotectItem(row.ratingKey) },
          }),
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  /**
   * `protect` doesn't hand back the new row's id — the store upserts on
   * (kind, value) — so the undo finds it by the same pair instead.
   */
  async function unprotectItem(ratingKey: string) {
    try {
      const all = await utils.cleanup.protections.fetch();
      const match = all.find((p) => p.kind === "item" && p.value === ratingKey);
      if (match) await unprotectMutation.mutateAsync({ id: match.id });
    } catch (err) {
      addToast((err as Error).message, "error");
    }
  }

  function keep(row: QueueRow) {
    holdMutation.mutate(
      { ruleId: row.ruleId, ratingKey: row.ratingKey, days: holdDays },
      {
        onSuccess: () =>
          addToast(`Keeping "${row.title}" for ${holdDays} days.`, "success", {
            action: {
              label: "Undo",
              onAction: () =>
                restoreMutation.mutate({
                  items: [{ ruleId: row.ruleId, ratingKey: row.ratingKey, heldUntil: row.heldUntil }],
                }),
            },
          }),
      },
    );
  }

  function release(row: QueueRow) {
    holdMutation.mutate(
      { ruleId: row.ruleId, ratingKey: row.ratingKey, days: null },
      {
        onSuccess: () =>
          addToast(`"${row.title}" is back in the queue.`, "success", {
            action: {
              label: "Undo",
              onAction: () =>
                restoreMutation.mutate({
                  items: [{ ruleId: row.ruleId, ratingKey: row.ratingKey, heldUntil: row.heldUntil }],
                }),
            },
          }),
      },
    );
  }

  if (query.error)
    return <ErrorState title="Couldn't load the cleanup queue" error={query.error} onRetry={() => query.refetch()} />;

  const destructiveDue = dueNow.filter((r) => DESTRUCTIVE.has(r.mode));

  /**
   * How much space the destructive rows would give back.
   *
   * Only the destructive modes: labelling something or dropping it from a
   * collection frees nothing, and counting those would inflate the number
   * that people will use to decide whether to let a run proceed. Items whose
   * size is unknown are counted separately and named, never folded in as
   * zero.
   */
  const reclaimable = destructiveDue.reduce((sum, r) => sum + (r.fileSize ?? 0), 0);
  const unsizedDue = destructiveDue.filter((r) => r.fileSize == null).length;

  return (
    <PageShell
      actions={
        <>
          {dueNow.length > 0 && (
            <StatusChip tone="error">
              {dueNow.length} due on the next run
              {destructiveDue.length > 0 ? ` · ${destructiveDue.length} destructive` : ""}
              {reclaimable > 0 ? ` · frees ${formatFileSize(reclaimable)}` : ""}
              {unsizedDue > 0 ? ` · ${unsizedDue} of unknown size` : ""}
            </StatusChip>
          )}
          <label className={styles.actionedToggle}>
            <input type="checkbox" checked={showActioned} onChange={(e) => setShowActioned(e.target.checked)} /> Show
            already actioned
          </label>
        </>
      }
    >
      <div className={styles.filters}>
        <SearchInput placeholder="Search titles…" ariaLabel="Search the queue" value={search} onChange={setSearch} />
        <MultiSelect
          allLabel="All rules"
          ariaLabel="Filter by rule"
          options={ruleOptions}
          selected={ruleFilter}
          onChange={setRuleFilter}
        />
        <MultiSelect
          allLabel="All actions"
          ariaLabel="Filter by action"
          options={modeOptions}
          selected={modeFilter}
          onChange={setModeFilter}
        />
        <span className={styles.segmented} role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={value === status}
              className={`${styles.segmentedBtn} ${value === status ? styles.segmentedBtnActive : ""}`}
              onClick={() => setStatus(value)}
            >
              {STATUS_LABELS[value]}
            </button>
          ))}
        </span>
        <div className={styles.filtersSpacer} />
        <label className={styles.holdPicker}>
          Keep for
          <select
            className={sharedStyles.input}
            value={holdDays}
            onChange={(e) => setHoldDays(Number(e.target.value))}
            aria-label="How long a reprieve lasts"
          >
            {HOLD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="list"
          title="Nothing queued"
          action={
            <button
              type="button"
              className={sharedStyles.button}
              onClick={() => navigate("/cleanup/rules", { state: { ruleSeed: NEW_CLEANUP_RULE } })}
            >
              New cleanup rule
            </button>
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="list"
          title="Nothing matches those filters"
          action={
            <button
              type="button"
              className={sharedStyles.buttonSecondary}
              onClick={() => {
                setSearch("");
                setRuleFilter([]);
                setModeFilter([]);
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="table-scroll">
          <table className={sharedStyles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    aria-label="Select everything shown"
                    checked={selectable.length > 0 && selectedRows.length === selectable.length}
                    onChange={() =>
                      setSelected(
                        selectedRows.length === selectable.length ? new Set() : new Set(selectable.map(rowKey)),
                      )
                    }
                  />
                </th>
                <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Title
                </SortableTh>
                <SortableTh sortKey="rule" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Rule
                </SortableTh>
                <SortableTh sortKey="action" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Action
                </SortableTh>
                <SortableTh
                  sortKey="streak"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={toggleSort}
                  title="Consecutive runs matched, of those needed. Resets when it stops matching."
                >
                  Streak
                </SortableTh>
                <SortableTh sortKey="size" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Size
                </SortableTh>
                <th>Status</th>
                <SortableTh sortKey="lastMatched" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Last matched
                </SortableTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const held = row.held;
                const actioned = row.actionedAt != null;
                return (
                  <tr key={rowKey(row)} className={actioned ? styles.rowActioned : undefined}>
                    <td className={styles.checkboxCell}>
                      {!actioned && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(rowKey(row))}
                          onChange={() => toggleRow(row)}
                        />
                      )}
                    </td>
                    <td>
                      <Link to={`/media/${row.ratingKey}`}>{row.title}</Link>
                      {/* The people who watch, as opposed to the person who
                          configures. Advisory — it changes nothing on its own,
                          which is the whole point: a deletion nobody wanted
                          becomes a decision rather than an event. */}
                      {row.keepVotes.length > 0 && (
                        <span className={styles.keepVotes} title={row.keepVotes.join(", ")}>
                          {row.keepVotes.length} asked to keep
                        </span>
                      )}
                    </td>
                    <td>
                      <Link to={`/cleanup/rules?q=${encodeURIComponent(row.ruleName)}`}>{row.ruleName}</Link>
                    </td>
                    <td>
                      <span className={DESTRUCTIVE.has(row.mode) ? styles.modeDestructive : undefined}>
                        {MODE_LABELS[row.mode] ?? row.mode}
                      </span>
                    </td>
                    <td>
                      {row.streak} / {row.consecutiveRuns}
                    </td>
                    <td className={styles.cellMuted}>{row.fileSize != null ? formatFileSize(row.fileSize) : EMPTY}</td>
                    <td>{statusText(row, held, actioned)}</td>
                    <td>
                      <RelativeTime timestamp={row.lastMatchedAt} />
                    </td>
                    <td className={styles.actionsCell}>
                      {actioned ? null : row.isProtected ? null : (
                        <>
                          {held ? (
                            <button
                              className={sharedStyles.buttonSecondary}
                              onClick={() => release(row)}
                              disabled={holdMutation.isPending}
                            >
                              Release
                            </button>
                          ) : (
                            <button
                              className={sharedStyles.buttonSecondary}
                              onClick={() => keep(row)}
                              disabled={holdMutation.isPending}
                              title="Hold back without changing the rule"
                            >
                              Keep
                            </button>
                          )}
                          {/* The approval gate, where a rule has one. Only on
                              rows that are actually due: approving something
                              three runs out is agreeing to a deletion whose
                              case hasn't been made yet, and the streak may
                              still reset. */}
                          {row.requiresApproval && row.runsRemaining === 0 && !held && (
                            <button
                              className={sharedStyles.buttonSecondary}
                              onClick={() =>
                                approveMutation.mutate({
                                  ruleId: row.ruleId,
                                  ratingKey: row.ratingKey,
                                  approved: !row.approved,
                                })
                              }
                              disabled={approveMutation.isPending}
                              title={
                                row.approved
                                  ? "Withdraw approval — the next run will leave this alone"
                                  : "Approve this item for the next run"
                              }
                            >
                              {row.approved ? "Unapprove" : "Approve"}
                            </button>
                          )}
                          {/* Beside Keep, because the choice between them is
                              the whole point: Keep buys time, Protect settles
                              it. Someone pressing Keep for the third time on
                              the same film wanted this. */}
                          <button
                            className={sharedStyles.buttonSecondary}
                            onClick={() => protect(row)}
                            disabled={protectMutation.isPending}
                            title="Never let a cleanup rule action this item"
                          >
                            Protect
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRows.length > 0 && (
        <BulkBar
          count={selectedRows.length}
          noun="item"
          onClear={() => setSelected(new Set())}
          actions={[
            {
              label: `Keep for ${HOLD_OPTIONS.find((o) => o.value === holdDays)?.label ?? `${holdDays} days`}`,
              tone: "primary",
              onClick: () => bulkHold(holdDays),
              disabled: holdManyMutation.isPending,
            },
            {
              label: "Release",
              onClick: () => bulkHold(null),
              disabled: holdManyMutation.isPending,
              title: "Put these back in the queue, streak and all",
            },
          ]}
        />
      )}
    </PageShell>
  );
}

function statusText(
  row: {
    runsRemaining: number;
    heldUntil: number | null;
    actionedAt: number | null;
    action: string;
    isProtected: boolean;
    requiresApproval: boolean;
    approved: boolean;
  },
  held: boolean,
  actioned: boolean,
): React.ReactNode {
  if (actioned) return <span className={styles.statusActioned}>{MODE_PAST_LABELS[row.action] ?? row.action}</span>;
  // Ahead of the hold and the streak: protection outranks both, and a row
  // reading "due next run" while the engine will skip it is the one thing
  // this page must never say.
  if (row.isProtected) return <span className={styles.statusHeld}>Protected</span>;
  if (held) {
    // A calendar date, not a relative span: RelativeTime renders any future
    // timestamp as "just now", and formatTimeUntil tops out in hours, so a
    // 90-day reprieve read as "in 2159h". The date is what someone wants
    // anyway — "when does this come back".
    return (
      <span className={styles.statusHeld} title={new Date(row.heldUntil!).toLocaleString()}>
        Held until{" "}
        {new Date(row.heldUntil!).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </span>
    );
  }
  if (row.runsRemaining === 0) {
    // A rule with an approval gate has two "due" states, and conflating them
    // is the failure this whole feature exists to prevent: "due on the next
    // run" on a row nothing will touch is exactly the wrong reassurance.
    if (row.requiresApproval && !row.approved) {
      return <span className={styles.statusWaiting}>Due — waiting for approval</span>;
    }
    return <span className={styles.statusDue}>Due next run</span>;
  }
  return (
    <span className={styles.statusWaiting}>
      {row.runsRemaining} more run{row.runsRemaining === 1 ? "" : "s"}
    </span>
  );
}
