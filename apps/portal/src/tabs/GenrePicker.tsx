/**
 * The genre tri-state, folded down to the genres the user has an opinion on.
 *
 * Every genre in the library used to be a row, always: thirty-odd rows of
 * which most said "no preference", and the fields below them were a long
 * scroll away. Collapsed, the list is the user's picks; the rest are one tap
 * away, with a filter, because finding "Western" in an alphabetical list of
 * thirty is a search, not a scroll.
 *
 * The buttons carry words beside their icons. A bare ♥ / + / ⊘ / — needed a
 * hover to decode, and a phone has no hover. "No preference" is no longer a
 * fourth button — tapping the lit choice again clears it, which is what people
 * tried first anyway.
 */
import { useState } from "react";
import { Ban, Heart, ThumbsUp, type LucideIcon } from "lucide-react";

export type GenreLevel = "none" | "loved" | "liked" | "hated";

const CHOICES: Array<{
  level: Exclude<GenreLevel, "none">;
  label: string;
  done: string;
  Icon: LucideIcon;
  hint: string;
}> = [
  { level: "loved", label: "Love", done: "loved", Icon: Heart, hint: "Lots more of this" },
  { level: "liked", label: "Like", done: "liked", Icon: ThumbsUp, hint: "A bit more of this" },
  { level: "hated", label: "Avoid", done: "avoided", Icon: Ban, hint: "Keep this away" },
];

/** Below this many genres a filter box is more furniture than help. */
const FILTER_THRESHOLD = 10;

interface Props {
  genres: string[];
  levelOf: (genre: string) => GenreLevel;
  onChange: (genre: string, level: GenreLevel) => void;
}

export function GenrePicker({ genres, levelOf, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  const picked = genres.filter((g) => levelOf(g) !== "none");
  const counts = CHOICES.map((c) => ({ ...c, n: picked.filter((g) => levelOf(g) === c.level).length })).filter(
    (c) => c.n > 0,
  );

  const needle = filter.trim().toLowerCase();
  const shown = expanded ? genres.filter((g) => g.toLowerCase().includes(needle)) : picked;

  if (genres.length === 0) return <div className="genre-empty muted">No genres available.</div>;

  return (
    <div className="genre-picker">
      <div className="genre-head">
        <span className="field-hint">
          {counts.length > 0 ? counts.map((c) => `${c.n} ${c.done}`).join(" · ") : "No genre preferences yet."}
        </span>
        <button
          type="button"
          className="btn-ghost genre-toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((e) => !e);
            setFilter("");
          }}
        >
          {expanded ? "Show only my picks" : picked.length > 0 ? `Show all ${genres.length}` : "Choose genres"}
        </button>
      </div>

      {expanded && genres.length > FILTER_THRESHOLD && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter genres…"
          aria-label="Filter genres"
        />
      )}

      {shown.length > 0 && (
        <div className="genre-box">
          {shown.map((g) => {
            const level = levelOf(g);
            return (
              <div key={g} className="genre-row">
                <span className="genre-name">{g}</span>
                <span className="seg" role="group" aria-label={g}>
                  {CHOICES.map(({ level: lv, label, Icon, hint }) => {
                    const on = level === lv;
                    return (
                      <button
                        key={lv}
                        type="button"
                        className={`${lv} ${on ? "on" : ""}`}
                        onClick={() => onChange(g, on ? "none" : lv)}
                        title={on ? `${hint} — tap again to clear` : hint}
                        aria-pressed={on}
                      >
                        <Icon size={16} aria-hidden fill={on && lv === "loved" ? "currentColor" : "none"} />
                        {label}
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {expanded && shown.length === 0 && <div className="genre-empty muted">No genre matches “{filter}”.</div>}
    </div>
  );
}
