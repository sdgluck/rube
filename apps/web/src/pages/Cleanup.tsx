import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell, { StatusChip } from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import sharedStyles from "#/styles/shared.module.css";
import styles from "./Cleanup.module.css";

/**
 * The cleanup queue — everything a cleanup rule has its eye on, across rules.
 *
 * This page is the reason the streak exists. A rule that deletes files on a
 * schedule is only acceptable if there is somewhere to see what it is about to
 * do while there is still time to say no, and "Keep" is that no.
 *
 * Deliberately read-only apart from the reprieve: rules are edited on the
 * Rules page, and an "action this now" button here would defeat the waiting
 * period the whole design rests on.
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

export default function Cleanup() {
  const [showActioned, setShowActioned] = useState(false);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const query = trpc.cleanup.queue.useQuery(
    { includeActioned: showActioned },
    { refetchOnWindowFocus: false, refetchInterval: 30_000 },
  );
  const holdMutation = trpc.cleanup.hold.useMutation({
    onSuccess: () => {
      utils.cleanup.queue.invalidate();
      utils.nav.metrics.invalidate();
    },
  });

  const rows = query.data ?? [];
  // A held item is explicitly not due, however long its streak. `held` comes
  // from the server so this can't disagree with what the engine will do.
  const dueNow = rows.filter((r) => r.actionedAt == null && r.runsRemaining === 0 && !r.held);

  function keep(ruleId: string, ratingKey: string, title: string) {
    holdMutation.mutate(
      { ruleId, ratingKey, days: 90 },
      { onSuccess: () => addToast(`Keeping "${title}" for 90 days`, "success") },
    );
  }

  function release(ruleId: string, ratingKey: string, title: string) {
    holdMutation.mutate(
      { ruleId, ratingKey, days: null },
      { onSuccess: () => addToast(`"${title}" is back in the queue`, "success") },
    );
  }

  if (query.error)
    return <ErrorState title="Couldn't load the cleanup queue" error={query.error} onRetry={() => query.refetch()} />;

  return (
    <PageShell
      actions={
        <>
          {dueNow.length > 0 && <StatusChip tone="error">{dueNow.length} due on the next run</StatusChip>}
          <label className={styles.toggle}>
            <input type="checkbox" checked={showActioned} onChange={(e) => setShowActioned(e.target.checked)} /> Show
            already actioned
          </label>
        </>
      }
    >
      <p className={styles.intro}>
        Items a cleanup rule has matched. Nothing happens until an item has matched on enough consecutive runs — if it
        stops matching, its streak resets and it leaves this list. <strong>Keep</strong> holds an item back for 90 days
        without changing the rule.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon="list"
          title="Nothing queued"
          description="No cleanup rule has matched anything yet. Rules with a Cleanup outcome track what they match here before acting on it."
        />
      ) : (
        <div className={sharedStyles.tableWrap}>
          <table className={sharedStyles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Rule</th>
                <th>Action</th>
                <th>Streak</th>
                <th>Status</th>
                <th>Last matched</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const held = row.held;
                const actioned = row.actionedAt != null;
                return (
                  <tr key={`${row.ruleId}:${row.ratingKey}`} className={actioned ? styles.rowActioned : undefined}>
                    <td>
                      <Link to={`/media/${row.ratingKey}`}>{row.title}</Link>
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
                    <td>{statusText(row, held, actioned)}</td>
                    <td>
                      <RelativeTime timestamp={row.lastMatchedAt} />
                    </td>
                    <td className={styles.actionsCell}>
                      {actioned ? null : held ? (
                        <button
                          className={sharedStyles.buttonSecondary}
                          onClick={() => release(row.ruleId, row.ratingKey, row.title)}
                          disabled={holdMutation.isPending}
                        >
                          Release
                        </button>
                      ) : (
                        <button
                          className={sharedStyles.buttonSecondary}
                          onClick={() => keep(row.ruleId, row.ratingKey, row.title)}
                          disabled={holdMutation.isPending}
                        >
                          Keep
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function statusText(
  row: { runsRemaining: number; heldUntil: number | null; actionedAt: number | null; action: string },
  held: boolean,
  actioned: boolean,
): React.ReactNode {
  if (actioned) return <span className={styles.statusActioned}>{MODE_PAST_LABELS[row.action] ?? row.action}</span>;
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
  if (row.runsRemaining === 0) return <span className={styles.statusDue}>Due on the next run</span>;
  return (
    <span className={styles.statusWaiting}>
      {row.runsRemaining} more run{row.runsRemaining === 1 ? "" : "s"}
    </span>
  );
}
