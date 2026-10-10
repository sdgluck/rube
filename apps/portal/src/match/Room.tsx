import { useEffect, useRef, useState } from "react";
import { describeMatchFilters } from "@tinkerbell/contracts";
import { haptic } from "@tinkerbell/native-client";
import { portalTrpc, type MatchState } from "../trpc.ts";
import ActionSheet from "../components/ActionSheet.tsx";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";
import Matches from "./Matches.tsx";
import ShareSheet from "./ShareSheet.tsx";
import SwipeDeck from "./SwipeDeck.tsx";
import { posterSrc } from "./film.ts";

/**
 * One room: the deck, the matches, and who's here. Polls the room every few
 * seconds while it's on screen (see `@tinkerbell/domain.match` for why a poll
 * rather than a socket), and turns what changed between polls into the two
 * things worth interrupting someone for: a person arriving, and a match.
 */
const POLL_MS = 3000;

export default function Room({
  code,
  onBack,
  onLeft,
}: {
  code: string;
  /** Back to the lobby, staying in the room. Absent for a guest, who has no lobby. */
  onBack?: () => void;
  onLeft: () => void;
}) {
  const stateQuery = portalTrpc.match.state.useQuery({ code }, { refetchInterval: POLL_MS });
  const leaveMutation = portalTrpc.match.leave.useMutation();
  const [view, setView] = useState<"swipe" | "matches">("swipe");
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [arrival, setArrival] = useState<string | null>(null);
  const [matched, setMatched] = useState<MatchState["matches"][number] | null>(null);

  const state = stateQuery.data;
  const seenMembers = useRef<Set<number> | null>(null);
  const seenMatches = useRef<Set<string> | null>(null);
  const pendingMatch = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    // The first poll is what was already here; only what changes after it is news.
    if (seenMembers.current) {
      const fresh = state.members.find((m) => !seenMembers.current!.has(m.id) && !m.me);
      if (fresh) setArrival(fresh.name);
    }
    seenMembers.current = new Set(state.members.map((m) => m.id));

    const unanimous = state.matches.filter((m) => m.unanimous);
    if (seenMatches.current) {
      const fresh = unanimous.find(
        (m) => !seenMatches.current!.has(m.ratingKey) || m.ratingKey === pendingMatch.current,
      );
      if (fresh) {
        setMatched(fresh);
        haptic("success");
      }
    }
    pendingMatch.current = null;
    seenMatches.current = new Set(unanimous.map((m) => m.ratingKey));
  }, [state]);

  useEffect(() => {
    if (!arrival) return;
    const t = setTimeout(() => setArrival(null), 3000);
    return () => clearTimeout(t);
  }, [arrival]);

  if (stateQuery.isLoading) return <RowsSkeleton rows={4} />;
  if (stateQuery.error || !state) {
    const gone = stateQuery.error?.data?.code === "NOT_FOUND" || stateQuery.error?.data?.code === "FORBIDDEN";
    return gone ? (
      <EmptyState
        title="This room isn't available"
        action={
          <button type="button" onClick={onBack ?? onLeft}>
            {onBack ? "Back to movie match" : "OK"}
          </button>
        }
      >
        {stateQuery.error?.message}
      </EmptyState>
    ) : (
      <ErrorState message={stateQuery.error?.message} onRetry={() => stateQuery.refetch()} />
    );
  }

  const online = state.members.filter((m) => m.online).length;
  const pills = describeMatchFilters(state.filters);

  function leave() {
    leaveMutation.mutate({ code }, { onSuccess: onLeft });
  }

  return (
    <div className="mm-room">
      <div className="mm-room-bar">
        {onBack ? (
          <button type="button" className="btn-ghost" onClick={onBack}>
            ‹ Rooms
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="mm-code" onClick={() => setSharing(true)} title="Invite people">
          {state.code}
          <span className="mm-small muted">
            {" "}
            · {online}/{state.members.length} here
          </span>
        </button>
        <button type="button" className="btn-ghost" onClick={() => setMenu(true)} aria-label="Room options">
          ⋯
        </button>
      </div>

      <p className="muted mm-center mm-small">
        {state.library}
        {pills.length > 0 ? ` · ${pills.join(" · ")}` : ""}
      </p>

      <div className="seg mm-views" role="tablist" aria-label="Room">
        <button
          type="button"
          role="tab"
          aria-selected={view === "swipe"}
          className={view === "swipe" ? "on" : ""}
          onClick={() => setView("swipe")}
        >
          Swipe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "matches"}
          className={view === "matches" ? "on" : ""}
          onClick={() => setView("matches")}
        >
          Matches{state.matches.length > 0 ? ` · ${state.matches.length}` : ""}
        </button>
      </div>

      {arrival && (
        <p className="mm-toast" role="status">
          {arrival} joined
        </p>
      )}

      {view === "swipe" ? (
        <SwipeDeck
          code={code}
          state={state}
          onMatched={(key) => {
            pendingMatch.current = key;
          }}
        />
      ) : (
        <Matches code={code} state={state} />
      )}

      {matched && (
        <div className="mm-match-overlay" role="alertdialog" aria-label="It's a match" onClick={() => setMatched(null)}>
          <p className="mm-match-head">It's a match</p>
          <p className="mm-match-sub">Everyone wants to watch this</p>
          {posterSrc(matched.poster) && <img className="mm-match-poster" src={posterSrc(matched.poster)!} alt="" />}
          <p className="mm-match-title">{matched.title}</p>
          <div className="mm-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                setMatched(null);
                setView("matches");
              }}
            >
              See matches
            </button>
            <button type="button" onClick={() => setMatched(null)}>
              Keep swiping
            </button>
          </div>
        </div>
      )}

      {sharing && <ShareSheet code={state.code} link={state.link} onClose={() => setSharing(false)} />}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={`Room ${state.code}`}
        actions={[
          { label: "Invite people", onSelect: () => setSharing(true) },
          { label: "Leave room", danger: true, onSelect: leave },
        ]}
      />
    </div>
  );
}
