import { useState } from "react";
import { portalTrpc, type MatchFilm, type MatchState } from "../trpc.ts";
import { EmptyState } from "../components/States.tsx";
import Sheet from "./Sheet.tsx";
import { filmMeta, plexLink, posterSrc } from "./film.ts";

/**
 * What the room agrees on: films everyone liked, then films more than one
 * person liked, and a "Watch this" vote among them for when there's more than
 * one contender. Fed by the room's poll, so it fills in as people swipe.
 */
export default function Matches({ code, state }: { code: string; state: MatchState }) {
  const utils = portalTrpc.useUtils();
  const voteMutation = portalTrpc.match.vote.useMutation({
    onSuccess: () => void utils.match.state.invalidate({ code }),
  });
  const [sort, setSort] = useState<"likes" | "recent">("likes");
  const [open, setOpen] = useState<MatchFilm | null>(null);

  const sorted = sort === "likes" ? state.matches : [...state.matches].sort((a, b) => b.lastLikedAt - a.lastLikedAt);
  const everyone = sorted.filter((m) => m.unanimous);
  const some = sorted.filter((m) => !m.unanimous);
  const votesFor = (key: string) => state.votes.find((v) => v.ratingKey === key)?.voters ?? [];
  const vote = (key: string) => voteMutation.mutate({ code, ratingKey: state.myVote === key ? null : key });

  return (
    <div className="stack mm-matches">
      <Members state={state} />

      {state.matches.length === 0 ? (
        <EmptyState title="No matches yet">
          A film shows up here once more than one person likes it, and goes to the top when everyone does.
        </EmptyState>
      ) : (
        <>
          <div className="row-between">
            <p className="muted mm-small">
              {state.unanimousCount} everyone agreed on, from {state.swipedCount} films seen
            </p>
            <div className="seg" role="group" aria-label="Sort matches">
              <button type="button" className={sort === "likes" ? "on" : ""} onClick={() => setSort("likes")}>
                Most liked
              </button>
              <button type="button" className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>
                Recent
              </button>
            </div>
          </div>
          {everyone.length > 0 && (
            <Section
              title="Everyone liked"
              films={everyone}
              state={state}
              votesFor={votesFor}
              onVote={vote}
              onOpen={setOpen}
            />
          )}
          {some.length > 0 && (
            <Section title="Some liked" films={some} state={state} votesFor={votesFor} onVote={vote} onOpen={setOpen} />
          )}
        </>
      )}

      {open && <Detail film={open} serverId={state.plexServerId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Members({ state }: { state: MatchState }) {
  return (
    <div className="list-group">
      {state.members.map((m) => (
        <div key={m.id} className="list-row">
          <span className="mm-member">
            <span className={`mm-dot ${m.online ? "mm-dot-on" : ""}`} aria-label={m.online ? "Here now" : "Away"} />
            {m.thumb ? <img className="mm-avatar" src={m.thumb} alt="" /> : null}
            {m.name}
            {m.me ? <span className="muted"> (you)</span> : m.guest ? <span className="muted"> (guest)</span> : null}
          </span>
          <span className="muted mm-small">
            {m.swiped}/{state.deckSize}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  films,
  state,
  votesFor,
  onVote,
  onOpen,
}: {
  title: string;
  films: MatchFilm[];
  state: MatchState;
  votesFor: (key: string) => string[];
  onVote: (key: string) => void;
  onOpen: (film: MatchFilm) => void;
}) {
  return (
    <section>
      <h3 className="mm-section-title">
        {title} <span className="mm-count">{films.length}</span>
      </h3>
      <div className="mm-grid">
        {films.map((film) => {
          const voters = votesFor(film.ratingKey);
          const mine = state.myVote === film.ratingKey;
          const poster = posterSrc(film.poster);
          return (
            <div key={film.ratingKey} className={`mm-tile ${film.unanimous ? "mm-tile-all" : ""}`}>
              <button
                type="button"
                className="mm-tile-open"
                onClick={() => onOpen(film)}
                aria-label={`About ${film.title}`}
              >
                {poster ? (
                  <img className="mm-tile-poster" src={poster} alt="" loading="lazy" />
                ) : (
                  <span className="mm-tile-poster mm-no-poster">{film.title}</span>
                )}
              </button>
              <div className="mm-tile-body">
                <p className="mm-tile-title">{film.title}</p>
                <p className="muted mm-small">{film.likedBy.join(", ")}</p>
                <button
                  type="button"
                  className={`mm-vote ${mine ? "btn-primary" : ""}`}
                  aria-pressed={mine}
                  onClick={() => onVote(film.ratingKey)}
                >
                  {mine ? "Your pick" : "Watch this"}
                  {voters.length > 0 ? ` · ${voters.length}` : ""}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Detail({ film, serverId, onClose }: { film: MatchFilm; serverId: string | null; onClose: () => void }) {
  const poster = posterSrc(film.poster);
  return (
    <Sheet title={film.title} onClose={onClose}>
      <div className="mm-detail">
        {poster && <img className="mm-detail-poster" src={poster} alt="" />}
        <div className="mm-detail-body">
          <h2 className="mm-sheet-title">{film.title}</h2>
          <p className="muted">{filmMeta(film)}</p>
          {film.genres.length > 0 && <p className="mm-small">{film.genres.join(", ")}</p>}
          <p className="mm-small">
            Liked by {film.likedBy.join(", ")}
            {film.unanimous ? " — everyone." : "."}
          </p>
          <div className="mm-actions">
            {serverId && (
              <a
                className="mm-link-button btn-primary"
                href={plexLink(serverId, film.ratingKey)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Plex
              </a>
            )}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
