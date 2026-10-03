import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import PageShell from "#components/PageShell";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import styles from "./Cleanup.module.css";

/**
 * The things no cleanup rule may ever touch.
 *
 * The queue's Keep button always expires — deliberately, so a rule that keeps
 * re-matching something comes back for review rather than being silently
 * overruled forever. That is the right default and the wrong only option.
 * "This film never goes" and "nothing in Favourites ever goes" are permanent
 * facts about a library, and expressing one of them by renewing a 90-day hold
 * four times a year is not expressing it at all.
 *
 * Protecting a collection is matched on its *title*, not its rating key.
 * Tinkerbell's own rules used to delete and recreate their collections every
 * run; they reconcile now and mostly keep their keys, but one rebuilt after
 * heavy churn still gets a fresh key — and a protection holding onto the old
 * one would come loose the night that happened.
 */
export default function CleanupProtected() {
  const [collectionTitle, setCollectionTitle] = useState("");
  const [note, setNote] = useState("");
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const query = trpc.cleanup.protections.useQuery();
  const invalidate = () => {
    utils.cleanup.protections.invalidate();
    utils.cleanup.queue.invalidate();
  };
  const protectMutation = trpc.cleanup.protect.useMutation({ onSuccess: invalidate });
  const unprotectMutation = trpc.cleanup.unprotect.useMutation({ onSuccess: invalidate });

  const collectionsQuery = trpc.collections.list.useQuery({ offset: 0, limit: 500 }, { refetchOnWindowFocus: false });
  const collectionOptions = collectionsQuery.data?.items ?? [];

  if (query.error) {
    return <ErrorState title="Couldn't load protections" error={query.error} onRetry={() => query.refetch()} />;
  }

  const rows = query.data ?? [];

  function addCollection() {
    const title = collectionTitle.trim();
    if (!title) return;
    protectMutation.mutate(
      { kind: "collection", value: title, label: title, note },
      {
        onSuccess: () => {
          setCollectionTitle("");
          setNote("");
          addToast(`Nothing in "${title}" will be actioned by a cleanup rule`, "success");
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  return (
    <PageShell count={rows.length > 0 ? String(rows.length) : undefined}>
      <div className={styles.filters}>
        <input
          className={shared.input}
          list="protect-collection-options"
          placeholder="Collection title…"
          aria-label="Collection to protect"
          value={collectionTitle}
          onChange={(e) => setCollectionTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCollection();
          }}
        />
        <datalist id="protect-collection-options">
          {collectionOptions.map((c) => (
            <option key={c.plexRatingKey} value={c.title} />
          ))}
        </datalist>
        <input
          className={shared.input}
          placeholder="Why (optional)"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className={shared.button}
          onClick={addCollection}
          disabled={!collectionTitle.trim() || protectMutation.isPending}
          title="Never expires, unlike Keep on the queue"
        >
          Protect collection
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="list"
          title="Nothing is protected"
          action={
            <Link to="/cleanup" className={shared.buttonSecondary}>
              Go to queue
            </Link>
          }
        />
      ) : (
        <div className="table-scroll">
          <table className={shared.table}>
            <thead>
              <tr>
                <th>What</th>
                <th>Kind</th>
                <th>Why</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.kind === "item" ? (
                      <Link to={`/media/${row.value}`}>{row.label}</Link>
                    ) : (
                      <>
                        {row.label}
                        <span className={styles.futureMembers}>incl. future members</span>
                      </>
                    )}
                  </td>
                  <td className={shared.cellMuted}>{row.kind === "item" ? "Item" : "Collection"}</td>
                  <td className={shared.cellMuted}>{row.note}</td>
                  <td className={shared.cellMuted}>
                    <RelativeTime timestamp={row.createdAt} />
                  </td>
                  <td className={styles.actionsCell}>
                    <button
                      type="button"
                      className={shared.buttonSecondary}
                      onClick={() => unprotectMutation.mutate({ id: row.id })}
                      disabled={unprotectMutation.isPending}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
