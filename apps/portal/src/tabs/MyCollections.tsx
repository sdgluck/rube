import { useEffect, useRef, useState } from "react";
import { portalTrpc, type PortalComponents } from "../trpc.ts";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";
import SwipeRow from "../components/SwipeRow.tsx";

/** How long "Not for me" can be taken back before it is sent. */
const UNDO_MS = 4000;

/**
 * What Tinkerbell built for this person, and the one-tap way to say it was
 * wrong.
 *
 * The portal used to be a form with no feedback: you rated fourteen genres,
 * pressed Save, and never learned whether any of it mattered. Showing the
 * output closes that loop, and "Not for me" turns a shrug into the one signal
 * the rules already know how to read.
 */
export default function MyCollections({
  components,
  onSetTastes,
}: {
  components: PortalComponents;
  /** Absent when the tastes tab is switched off — nowhere to send them. */
  onSetTastes?: () => void;
}) {
  const utils = portalTrpc.useUtils();
  const collectionsQuery = portalTrpc.myCollections.useQuery();
  const notInterested = portalTrpc.notInterested.useMutation();
  const [excluded, setExcluded] = useState<string[]>([]);
  /** Titles marked "Not for me" whose undo window is still open. */
  const [pending, setPending] = useState<string[]>([]);
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  if (collectionsQuery.isLoading) return <RowsSkeleton />;

  // Before the empty state, deliberately: a failed request used to render
  // "nothing yet", so "the server is unreachable" and "you have no
  // collections" were the same screen.
  if (collectionsQuery.error) {
    return <ErrorState message={collectionsQuery.error.message} onRetry={() => collectionsQuery.refetch()} />;
  }

  const collections = collectionsQuery.data ?? [];
  if (collections.length === 0) {
    return (
      <EmptyState
        title="Nothing yet"
        action={
          onSetTastes && (
            <button type="button" className="btn-primary" onClick={onSetTastes}>
              Set your tastes
            </button>
          )
        }
      >
        They arrive after the next nightly run.
      </EmptyState>
    );
  }

  /**
   * Optimistic, and undoable: the row folds away at once and the request goes
   * a few seconds later, so a slip of the thumb (or of a swipe) is one tap to
   * take back — native lists do it this way, and the server has no "un-not-
   * for-me" to call afterwards.
   */
  const exclude = (title: string) => {
    setPending((prev) => [...prev, title]);
    timers.current.set(
      title,
      window.setTimeout(() => {
        timers.current.delete(title);
        setPending((prev) => prev.filter((t) => t !== title));
        setExcluded((prev) => [...prev, title]);
        notInterested.mutate({ title }, { onSuccess: () => utils.preferences.get.invalidate() });
      }, UNDO_MS),
    );
  };
  const undo = (title: string) => {
    window.clearTimeout(timers.current.get(title));
    timers.current.delete(title);
    setPending((prev) => prev.filter((t) => t !== title));
  };

  return (
    <div className="stack">
      {collections.map((collection) =>
        pending.includes(collection.title) ? (
          <div key={collection.ratingKey} className="collection-row undo-row" role="status">
            <span className="muted">You won't see “{collection.title}” again.</span>
            <button type="button" className="btn-ghost" onClick={() => undo(collection.title)}>
              Undo
            </button>
          </div>
        ) : (
          <SwipeRow
            key={collection.ratingKey}
            tone="danger"
            disabled={!components["action.notForMe"] || excluded.includes(collection.title)}
            action={{ label: "Not for me", onAction: () => exclude(collection.title) }}
          >
            <div className="collection-row">
              <div className="collection-head">
                <span className="collection-title">{collection.title}</span>
                <span className="muted">
                  {collection.itemCount} item{collection.itemCount === 1 ? "" : "s"}
                </span>
              </div>
              {collection.summary && <p className="collection-summary">{collection.summary}</p>}
              {components["action.notForMe"] && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={excluded.includes(collection.title)}
                  onClick={() => exclude(collection.title)}
                >
                  {excluded.includes(collection.title) ? "Won't show this again" : "Not for me"}
                </button>
              )}
            </div>
          </SwipeRow>
        ),
      )}
    </div>
  );
}
