import { portalTrpc } from "../trpc.ts";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";

/**
 * What a cleanup rule is about to remove, and the way to say you would rather
 * it didn't.
 *
 * The admin's queue page has always been able to show this, to exactly one
 * person. Everybody else found out when the film stopped being there — and
 * the entire argument for the streak is that a scheduled deletion is
 * tolerable only when somebody can see it coming.
 *
 * The button records a vote, not a hold. A shared user must not be able to
 * silently overrule the server owner's rule; what they can do is make sure
 * that removing something turns into a decision the owner makes, rather than
 * one that simply happens at 4am.
 */
export default function LeavingSoon() {
  const utils = portalTrpc.useUtils();
  const leavingQuery = portalTrpc.leavingSoon.useQuery();
  const voteKeep = portalTrpc.voteKeep.useMutation({ onSuccess: () => utils.leavingSoon.invalidate() });

  const items = leavingQuery.data ?? [];

  return (
    <div className="stack">
      {leavingQuery.isLoading && <RowsSkeleton rows={2} />}

      {leavingQuery.error && <ErrorState message={leavingQuery.error.message} onRetry={() => leavingQuery.refetch()} />}

      {!leavingQuery.isLoading && !leavingQuery.error && items.length === 0 && (
        <EmptyState title="Nothing is going anywhere" />
      )}

      {items.length > 0 && (
        <>
          <p className="field-hint">Queued for removal. The server owner sees who asks to keep one.</p>
          {items.map((item) => (
            <div key={item.ratingKey} className="collection-row">
              <div className="collection-head">
                <span className="collection-title">{item.title}</span>
                <span className="muted">
                  {item.runsRemaining === 0
                    ? "Goes on the next run"
                    : `In ${item.runsRemaining} more run${item.runsRemaining === 1 ? "" : "s"}`}
                </span>
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={voteKeep.isPending}
                onClick={() => voteKeep.mutate({ ratingKey: item.ratingKey, keep: !item.voted })}
              >
                {item.voted ? "Asked to keep \u2713" : "Keep this"}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
