import { useState } from "react";
import { haptic } from "@tinkerbell/native-client";
import { portalTrpc, type PortalComponents } from "../trpc.ts";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";
import SwipeRow from "../components/SwipeRow.tsx";

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
export default function LeavingSoon({ components }: { components: PortalComponents }) {
  // Off, the list is still worth reading: knowing something is going is the
  // part that matters, and the vote is the admin's to offer.
  const canVote = components["action.keep"];
  const utils = portalTrpc.useUtils();
  const leavingQuery = portalTrpc.leavingSoon.useQuery();
  const voteKeep = portalTrpc.voteKeep.useMutation({ onSettled: () => utils.leavingSoon.invalidate() });
  // The vote shows at once, per item. It used to wait on the server and
  // disable every row's button while one request was in flight.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const vote = (ratingKey: string, keep: boolean) => {
    haptic(keep ? "success" : "light");
    setOptimistic((prev) => ({ ...prev, [ratingKey]: keep }));
    voteKeep.mutate(
      { ratingKey, keep },
      {
        onError: () =>
          setOptimistic((prev) => {
            const next = { ...prev };
            delete next[ratingKey];
            return next;
          }),
      },
    );
  };

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
          <p className="field-hint">
            {canVote ? "Queued for removal. The server owner sees who asks to keep one." : "Queued for removal."}
          </p>
          {items.map((item) => {
            const voted = optimistic[item.ratingKey] ?? item.voted;
            return (
              <SwipeRow
                key={item.ratingKey}
                disabled={!canVote}
                action={{ label: voted ? "Undo keep" : "Keep", onAction: () => vote(item.ratingKey, !voted) }}
              >
                <div className="collection-row">
                  <div className="collection-head">
                    <span className="collection-title">{item.title}</span>
                    <span className="muted">
                      {item.runsRemaining === 0
                        ? "Goes on the next run"
                        : `In ${item.runsRemaining} more run${item.runsRemaining === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {canVote && (
                    <button
                      type="button"
                      className={`btn-ghost ${voted ? "voted" : ""}`}
                      onClick={() => vote(item.ratingKey, !voted)}
                    >
                      {voted ? "Asked to keep \u2713" : "Keep this"}
                    </button>
                  )}
                </div>
              </SwipeRow>
            );
          })}
        </>
      )}
    </div>
  );
}
