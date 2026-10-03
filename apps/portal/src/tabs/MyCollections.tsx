import { useState } from "react";
import { portalTrpc } from "../trpc.ts";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";

/**
 * What Tinkerbell built for this person, and the one-tap way to say it was
 * wrong.
 *
 * The portal used to be a form with no feedback: you rated fourteen genres,
 * pressed Save, and never learned whether any of it mattered. Showing the
 * output closes that loop, and "Not for me" turns a shrug into the one signal
 * the rules already know how to read.
 */
export default function MyCollections({ onSetTastes }: { onSetTastes: () => void }) {
  const utils = portalTrpc.useUtils();
  const collectionsQuery = portalTrpc.myCollections.useQuery();
  const notInterested = portalTrpc.notInterested.useMutation();
  const [excluded, setExcluded] = useState<string[]>([]);

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
          <button type="button" className="btn-primary" onClick={onSetTastes}>
            Set your tastes
          </button>
        }
      >
        They arrive after the next nightly run.
      </EmptyState>
    );
  }

  const exclude = (title: string) => {
    // Optimistic, and local: the row is about to disappear from the next run's
    // output anyway, and waiting on a round-trip to grey out a button makes a
    // one-tap gesture feel like a form submission.
    setExcluded((prev) => [...prev, title]);
    notInterested.mutate({ title }, { onSuccess: () => utils.preferences.get.invalidate() });
  };

  return (
    <div className="stack">
      {collections.map((collection) => (
        <div key={collection.ratingKey} className="collection-row">
          <div className="collection-head">
            <span className="collection-title">{collection.title}</span>
            <span className="muted">
              {collection.itemCount} item{collection.itemCount === 1 ? "" : "s"}
            </span>
          </div>
          {collection.summary && <p className="collection-summary">{collection.summary}</p>}
          <button
            type="button"
            className="btn-ghost"
            disabled={excluded.includes(collection.title)}
            onClick={() => exclude(collection.title)}
          >
            {excluded.includes(collection.title) ? "Won't show this again" : "Not for me"}
          </button>
        </div>
      ))}
    </div>
  );
}
