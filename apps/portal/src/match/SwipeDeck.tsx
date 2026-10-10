import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "@tinkerbell/native-client";
import { portalTrpc, portalTrpcClient, type MatchCard, type MatchState } from "../trpc.ts";
import { filmMeta, posterSrc } from "./film.ts";

/**
 * The cards. One shared order per room (the server's), dealt in pages of what
 * this member hasn't seen yet; swiping is optimistic, so the next card is there
 * before the server has answered.
 *
 * Gestures are pointer events on the card rather than a gesture library, so a
 * mouse drag works on a desktop and a thumb on a phone; the buttons and the
 * arrow keys do the same thing for anyone who doesn't drag.
 */

const PAGE = 20;
/** Fetch the next page when this few cards are left in hand. */
const LOW_WATER = 5;
/** How far a card has to travel to count as a swipe rather than a wobble. */
const THRESHOLD = 110;
const FLING_MS = 260;

type Dir = "like" | "nope";

export default function SwipeDeck({
  code,
  state,
  onMatched,
}: {
  code: string;
  state: MatchState;
  onMatched: (ratingKey: string) => void;
}) {
  const utils = portalTrpc.useUtils();
  const swipeMutation = portalTrpc.match.swipe.useMutation();
  const undoMutation = portalTrpc.match.undo.useMutation();
  const resetMutation = portalTrpc.match.reset.useMutation();

  const [cards, setCards] = useState<MatchCard[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ film: MatchCard; liked: boolean } | null>(null);
  const [fling, setFling] = useState<Dir | null>(null);
  const fetching = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const deal = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const held = cardsRef.current.map((c) => c.ratingKey);
      const page = await portalTrpcClient.match.deck.query({ code, exclude: held, limit: PAGE });
      setCards((prev) => {
        const have = new Set(prev.map((c) => c.ratingKey));
        return [...prev, ...page.films.filter((f) => !have.has(f.ratingKey))];
      });
      setRemaining(page.remaining - page.films.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load films.");
    } finally {
      fetching.current = false;
    }
  }, [code]);

  useEffect(() => {
    if (remaining === null || (cards.length < LOW_WATER && remaining > 0)) void deal();
  }, [cards.length, remaining, deal]);

  // The next few posters, fetched ahead, so a swipe never reveals a blank card.
  useEffect(() => {
    for (const film of cards.slice(1, 4)) {
      const src = posterSrc(film.poster);
      if (src) new Image().src = src;
    }
  }, [cards]);

  const commit = useCallback(
    (dir: Dir) => {
      const film = cardsRef.current[0];
      setFling(null);
      if (!film) return;
      const liked = dir === "like";
      setCards((prev) => prev.slice(1));
      setLast({ film, liked });
      swipeMutation.mutate(
        { code, ratingKey: film.ratingKey, liked },
        {
          onSuccess: (res) => {
            if (res.matched) onMatched(film.ratingKey);
            void utils.match.state.invalidate({ code });
          },
          onError: (e) => {
            // Put it back: a swipe the room never heard about didn't happen.
            setCards((prev) => [film, ...prev]);
            setLast(null);
            setError(e.message);
          },
        },
      );
    },
    [code, onMatched, swipeMutation, utils],
  );

  const swipe = useCallback(
    (dir: Dir) => {
      if (fling || !cardsRef.current[0]) return;
      haptic(dir === "like" ? "medium" : "light");
      setFling(dir);
    },
    [fling],
  );

  function undo() {
    if (!last) return;
    const { film } = last;
    setLast(null);
    setCards((prev) => [film, ...prev.filter((c) => c.ratingKey !== film.ratingKey)]);
    undoMutation.mutate(
      { code, ratingKey: film.ratingKey },
      { onSuccess: () => void utils.match.state.invalidate({ code }), onError: (e) => setError(e.message) },
    );
  }

  function startOver() {
    resetMutation.mutate(
      { code },
      {
        onSuccess: () => {
          setCards([]);
          setLast(null);
          setRemaining(null);
          void utils.match.state.invalidate({ code });
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") swipe("like");
      else if (e.key === "ArrowLeft") swipe("nope");
      else if (e.key === "z" && (e.metaKey || e.ctrlKey)) undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [top, next] = cards;
  const done = !top && remaining === 0;

  return (
    <div className="mm-deck-wrap">
      <div className="mm-deck">
        {!top && remaining !== 0 && <div className="mm-card mm-card-skeleton" aria-busy="true" />}
        {done && (
          <div className="mm-done">
            <p className="state-title">That's every film in this room.</p>
            <p className="muted">See what everyone agreed on, or go round again.</p>
            <button type="button" onClick={startOver} disabled={resetMutation.isPending}>
              Start over
            </button>
          </div>
        )}
        {next && <Card key={next.ratingKey} film={next} behind />}
        {top && <Card key={top.ratingKey} film={top} fling={fling} onSwipe={swipe} onFlung={commit} />}
      </div>

      {error && (
        <p className="err mm-center" role="alert">
          {error}
        </p>
      )}

      <div className="mm-controls">
        <button
          type="button"
          className="mm-round mm-nope"
          onClick={() => swipe("nope")}
          disabled={!top}
          aria-label="Skip"
        >
          ✕
        </button>
        <button type="button" className="btn-ghost" onClick={undo} disabled={!last} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button
          type="button"
          className="mm-round mm-like"
          onClick={() => swipe("like")}
          disabled={!top}
          aria-label="Like"
        >
          ♥
        </button>
      </div>
      <p className="muted mm-center mm-small">
        {state.me.liked} liked · {state.me.swiped} of {state.deckSize} films
      </p>
    </div>
  );
}

function Card({
  film,
  behind,
  fling,
  onSwipe,
  onFlung,
}: {
  film: MatchCard;
  behind?: boolean;
  fling?: Dir | null;
  onSwipe?: (dir: Dir) => void;
  onFlung?: (dir: Dir) => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  // A fling — from a drag, a button or a key — animates out, then commits.
  // Through a ref, so the room's poll re-rendering mid-flight can't restart it.
  const flung = useRef(onFlung);
  flung.current = onFlung;
  useEffect(() => {
    if (!fling) return;
    const t = setTimeout(() => flung.current?.(fling), FLING_MS);
    return () => clearTimeout(t);
  }, [fling]);

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (behind || fling) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, at: performance.now() };
    setDragging(true);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const travel = e.clientX - start.current.x;
    const speed = Math.abs(travel) / Math.max(1, performance.now() - start.current.at);
    start.current = null;
    setDragging(false);
    if (Math.abs(travel) > THRESHOLD || (Math.abs(travel) > 40 && speed > 0.6)) {
      onSwipe?.(travel > 0 ? "like" : "nope");
    } else {
      setDx(0);
    }
  }

  const x = fling ? (fling === "like" ? 1 : -1) * (window.innerWidth + 200) : dx;
  const tilt = x / 18;
  const like = Math.max(0, Math.min(1, x / THRESHOLD));
  const nope = Math.max(0, Math.min(1, -x / THRESHOLD));
  const poster = posterSrc(film.poster);
  const meta = filmMeta(film);

  return (
    <div
      className={`mm-card ${behind ? "mm-card-behind" : ""} ${dragging ? "" : "mm-card-settling"}`}
      style={behind ? undefined : { transform: `translateX(${x}px) rotate(${tilt}deg)` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-hidden={behind || undefined}
    >
      {poster ? (
        <img className="mm-poster" src={poster} alt="" draggable={false} />
      ) : (
        <div className="mm-poster mm-no-poster">{film.title}</div>
      )}
      {!behind && (
        <>
          <span className="mm-stamp mm-stamp-like" style={{ opacity: like }}>
            Like
          </span>
          <span className="mm-stamp mm-stamp-nope" style={{ opacity: nope }}>
            Nope
          </span>
        </>
      )}
      <div className="mm-card-info">
        <h3 className="mm-card-title">{film.title}</h3>
        {meta && <p className="mm-card-meta">{meta}</p>}
        {film.genres.length > 0 && (
          <div className="mm-genres">
            {film.genres.slice(0, 3).map((g) => (
              <span key={g} className="mm-genre">
                {g}
              </span>
            ))}
          </div>
        )}
        {film.summary && <p className="mm-summary">{film.summary}</p>}
      </div>
    </div>
  );
}
