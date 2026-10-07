import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import ConfirmModal from "#components/ConfirmModal";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import styles from "./Rules.module.css";
import local from "./RuleHistoryRow.module.css";

interface RuleHistoryRowProps {
  ruleId: string;
}

/** "config.limit" reads better as "limit" once you already know it's a rule. */
function fieldLabel(path: string): string {
  return path.replace(/^config\./, "");
}

/**
 * A value, short enough to sit on one line of a table.
 *
 * Objects and arrays are summarised rather than pretty-printed: a smart filter
 * rendered in full would be forty lines in a row that exists to say "the smart
 * filter changed", and the version itself is one click away.
 */
function summarise(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? "(none)" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "(changed)";
}

/**
 * Who did it, in words.
 *
 * `system` covers boot-time seeding and migrations, which is not a sentence
 * anybody would write on purpose — so it says so rather than showing the raw
 * token, and a job says which job.
 */
function actorLabel(source: string, username: string): string {
  if (username) return username;
  if (source === "system") return "Tinkerbell itself";
  if (source.startsWith("job:")) return `the ${source.slice(4)} job`;
  if (source === "import") return "an import";
  if (source === "restore") return "a restore";
  return source;
}

export default function RuleHistoryRow({ ruleId }: RuleHistoryRowProps) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const [pendingRestore, setPendingRestore] = useState<{ id: number; at: number } | null>(null);

  const historyQuery = trpc.history.list.useQuery({ entity: "rule", entityId: ruleId, limit: 50 });
  const restoreMutation = trpc.history.restore.useMutation({
    onSuccess: () => {
      addToast("Restored", "success");
      utils.history.list.invalidate({ entity: "rule", entityId: ruleId });
      utils.rules.list.invalidate();
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const entries = historyQuery.data?.entries ?? [];

  return (
    <tr className={styles.detailRow}>
      <td colSpan={9}>
        <div className={styles.detailWrap}>
          <div className={styles.detailHeader}>
            <span className={styles.detailTitle}>History</span>
          </div>

          {historyQuery.error && (
            <ErrorState
              inline
              title="Couldn't load this rule's history"
              error={historyQuery.error}
              onRetry={() => historyQuery.refetch()}
            />
          )}

          {!historyQuery.isLoading && entries.length === 0 && (
            <div className={styles.testPreviewEmpty}>No recorded changes yet.</div>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className={local.entry}>
              <div className={local.entryHead}>
                <span className={local.action} data-action={entry.action}>
                  {entry.action}
                </span>
                <RelativeTime timestamp={entry.timestamp} />
                <span className={local.actor}>by {actorLabel(entry.source, entry.username)}</span>
                {entry.restorable && (
                  <button
                    type="button"
                    className={local.restoreBtn}
                    disabled={restoreMutation.isPending}
                    onClick={() => setPendingRestore({ id: entry.id, at: entry.timestamp })}
                  >
                    <RotateCcw size="1.3rem" aria-hidden />
                    Restore this version
                  </button>
                )}
              </div>

              {entry.action === "delete" ? (
                <div className={local.note}>The rule was deleted. Its last state is kept here for reference.</div>
              ) : entry.fields.length === 0 ? (
                <div className={local.note}>Created.</div>
              ) : (
                <ul className={local.fields}>
                  {entry.fields.map((field) => (
                    <li key={field.path}>
                      <span className={local.fieldName}>{fieldLabel(field.path)}</span>
                      {field.kind === "added" ? (
                        <span>
                          set to <ins>{summarise(field.after)}</ins>
                        </span>
                      ) : field.kind === "removed" ? (
                        <span>
                          cleared (was <del>{summarise(field.before)}</del>)
                        </span>
                      ) : (
                        <span>
                          <del>{summarise(field.before)}</del> → <ins>{summarise(field.after)}</ins>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {pendingRestore && (
          <ConfirmModal
            title="Restore this version"
            message={"Saved as a new change, so it can be undone. The next run uses it."}
            confirmLabel="Restore"
            onConfirm={() => {
              restoreMutation.mutate({ id: pendingRestore.id });
              setPendingRestore(null);
            }}
            onCancel={() => setPendingRestore(null)}
          />
        )}
      </td>
    </tr>
  );
}
