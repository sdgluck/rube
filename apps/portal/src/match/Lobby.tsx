import { useEffect, useState } from "react";
import { describeMatchFilters, MATCH_CODE_ALPHABET, MATCH_CODE_LENGTH, type MatchFilters } from "@rube/contracts";
import { portalTrpc } from "../trpc.ts";
import { useDebounced } from "../useDebounced.ts";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";

/**
 * Movie match's front door, for a user of this server: start a room, join one
 * by its code, or go back to one you're in. Guests never see this — they
 * arrive in a room on its invite link.
 */

const LENGTHS = [
  { label: "Any length", value: 0 },
  { label: "Under 90 min", value: 90 },
  { label: "Under 2 hours", value: 120 },
  { label: "Under 2½ hours", value: 150 },
];

const ERAS = [
  { label: "Any year", value: "any" },
  { label: "Last 5 years", value: "5" },
  { label: "Last 10 years", value: "10" },
  { label: "Last 20 years", value: "20" },
  { label: "Before 2000", value: "classic" },
] as const;
type Era = (typeof ERAS)[number]["value"];

/** The filters remembered between rooms, since a household tends to want the same evening twice. */
const LAST_FILTERS_KEY = "tb_match_last_filters";

function eraFilters(era: Era): MatchFilters {
  if (era === "any") return {};
  if (era === "classic") return { maxYear: 1999 };
  return { minYear: new Date().getFullYear() - Number(era) };
}

export default function Lobby({ onOpen }: { onOpen: (code: string) => void }) {
  const [step, setStep] = useState<"home" | "library" | "filters">("home");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const librariesQuery = portalTrpc.match.libraries.useQuery();

  function start() {
    const libs = librariesQuery.data ?? [];
    if (libs.length === 1) {
      setSectionId(libs[0]!.key);
      setStep("filters");
    } else setStep("library");
  }

  if (step === "library") {
    return (
      <div className="stack">
        <button type="button" className="btn-ghost mm-back" onClick={() => setStep("home")}>
          ‹ Back
        </button>
        <h2 className="mm-heading">Which library?</h2>
        <div className="list-group">
          {(librariesQuery.data ?? []).map((lib) => (
            <button
              key={lib.key}
              type="button"
              className="list-row list-button"
              onClick={() => {
                setSectionId(lib.key);
                setStep("filters");
              }}
            >
              <span>{lib.title}</span>
              <span className="muted">{lib.count} films</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === "filters" && sectionId) {
    const single = (librariesQuery.data ?? []).length === 1;
    return <NewRoom sectionId={sectionId} onBack={() => setStep(single ? "home" : "library")} onCreated={onOpen} />;
  }

  return <Home onStart={start} onOpen={onOpen} />;
}

function Home({ onStart, onOpen }: { onStart: () => void; onOpen: (code: string) => void }) {
  // The same query as the lobby's, so this is the cached answer, not a second request.
  const librariesQuery = portalTrpc.match.libraries.useQuery();
  const roomsQuery = portalTrpc.match.rooms.useQuery();
  const joinMutation = portalTrpc.match.join.useMutation();
  const [code, setCode] = useState("");
  const allowed = new RegExp(`[^${MATCH_CODE_ALPHABET}]`, "g");

  function join() {
    joinMutation.mutate({ code }, { onSuccess: (r) => onOpen(r.code) });
  }

  const noLibraries = librariesQuery.data && librariesQuery.data.length === 0;

  return (
    <div className="stack">
      <p className="lede mm-lede">
        Can't decide what to watch? Start a room, invite whoever's watching, and swipe through the films. Anything
        everyone likes is a match.
      </p>
      {librariesQuery.error ? (
        <ErrorState message={librariesQuery.error.message} onRetry={() => librariesQuery.refetch()} />
      ) : noLibraries ? (
        <EmptyState title="No movie libraries">None of the movie libraries here are shared with you.</EmptyState>
      ) : (
        <button type="button" className="btn-primary" onClick={onStart} disabled={!librariesQuery.data}>
          Start a room
        </button>
      )}

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === MATCH_CODE_LENGTH) join();
        }}
      >
        <label className="field-label" htmlFor="mm-join-code">
          Join with a code
        </label>
        <div className="mm-join">
          <input
            id="mm-join-code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={MATCH_CODE_LENGTH}
            placeholder="ABCD"
            className="mm-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(allowed, ""))}
          />
          <button type="submit" disabled={code.length !== MATCH_CODE_LENGTH || joinMutation.isPending}>
            Join
          </button>
        </div>
        {joinMutation.error && <span className="err field-hint">{joinMutation.error.message}</span>}
      </form>

      {roomsQuery.isLoading ? (
        <RowsSkeleton rows={2} />
      ) : (
        (roomsQuery.data ?? []).length > 0 && (
          <div className="field">
            <span className="field-label">Your rooms</span>
            <div className="list-group">
              {roomsQuery.data!.map((room) => {
                const pills = describeMatchFilters(room.filters);
                return (
                  <button
                    key={room.code}
                    type="button"
                    className="list-row list-button"
                    onClick={() => onOpen(room.code)}
                  >
                    <span className="mm-room-row">
                      <strong className="mm-code-inline">{room.code}</strong>
                      <span className="muted mm-small">
                        {room.library}
                        {pills.length ? ` · ${pills.join(" · ")}` : ""}
                      </span>
                    </span>
                    <span className="muted mm-small">{room.members.join(", ")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function NewRoom({
  sectionId,
  onBack,
  onCreated,
}: {
  sectionId: string;
  onBack: () => void;
  onCreated: (code: string) => void;
}) {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_FILTERS_KEY) ?? "{}") as {
        genres?: string[];
        maxMinutes?: number;
        era?: Era;
      };
    } catch {
      return {};
    }
  })();
  const [genres, setGenres] = useState<string[]>(saved.genres ?? []);
  const [maxMinutes, setMaxMinutes] = useState(saved.maxMinutes ?? 0);
  const [era, setEra] = useState<Era>(saved.era ?? "any");

  const genresQuery = portalTrpc.match.genres.useQuery({ sectionId });
  const presetsQuery = portalTrpc.match.presets.useQuery({ sectionId }, { staleTime: Infinity });
  const createMutation = portalTrpc.match.create.useMutation();

  // A remembered genre the library doesn't have would filter to nothing.
  useEffect(() => {
    if (genresQuery.data) setGenres((g) => g.filter((x) => genresQuery.data!.includes(x)));
  }, [genresQuery.data]);

  const filters: MatchFilters = {
    ...(genres.length ? { genres } : {}),
    ...(maxMinutes ? { maxMinutes } : {}),
    ...eraFilters(era),
  };
  // Debounced as a string: the object is new every render, and debouncing it
  // would re-arm the timer on every render it causes.
  const debounced = useDebounced(JSON.stringify(filters), 250);
  const countQuery = portalTrpc.match.count.useQuery({ sectionId, filters: JSON.parse(debounced) as MatchFilters });

  function create(f: MatchFilters) {
    try {
      localStorage.setItem(LAST_FILTERS_KEY, JSON.stringify({ genres, maxMinutes, era }));
    } catch {
      /* not remembered, then */
    }
    createMutation.mutate({ sectionId, filters: f }, { onSuccess: (r) => onCreated(r.code) });
  }

  const n = countQuery.data;
  return (
    <div className="stack">
      <button type="button" className="btn-ghost mm-back" onClick={onBack}>
        ‹ Back
      </button>
      <button
        type="button"
        className="btn-primary"
        onClick={() => create(filters)}
        disabled={createMutation.isPending || n === 0}
      >
        {createMutation.isPending ? "Starting…" : n === undefined ? "Start the room" : `Start the room · ${n} films`}
      </button>
      {createMutation.error && <p className="err">{createMutation.error.message}</p>}

      {(presetsQuery.data ?? []).length > 0 && (
        <div className="field">
          <span className="field-label">Or try one of these</span>
          <div className="mm-presets">
            {presetsQuery.data!.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip mm-preset"
                onClick={() => create(p.filters)}
                disabled={createMutation.isPending}
              >
                {p.label} <span className="muted">· {p.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Genres</span>
        {genresQuery.isLoading ? (
          <RowsSkeleton rows={1} />
        ) : (
          <div className="chips">
            <button type="button" className={`chip ${genres.length === 0 ? "on" : ""}`} onClick={() => setGenres([])}>
              Any
            </button>
            {(genresQuery.data ?? []).map((g) => {
              const on = genres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  className={`chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setGenres((cur) => (on ? cur.filter((x) => x !== g) : [...cur, g]))}
                >
                  {g}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">Length</span>
        <div className="mm-presets">
          {LENGTHS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`chip ${maxMinutes === o.value ? "on" : ""}`}
              onClick={() => setMaxMinutes(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Released</span>
        <div className="mm-presets">
          {ERAS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`chip ${era === o.value ? "on" : ""}`}
              onClick={() => setEra(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
