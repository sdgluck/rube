import { useEffect, useRef, useState } from "react";
import { portalTrpc, type PortalComponents } from "../trpc.ts";
import { ErrorState, RowsSkeleton } from "../components/States.tsx";
import { useDebounced } from "../useDebounced.ts";
import { GenrePicker, type GenreLevel } from "./GenrePicker.tsx";

interface FormState {
  loved: string[];
  liked: string[];
  hated: string[];
  moods: string[];
  excludedTitles: string[];
  ratingFloor: string;
  rowCount: string;
  watchedBias: "new_to_me" | "include_favorites" | "balanced";
  strictHate: boolean;
  optedIn: boolean;
  digestFrequency: "never" | "weekly" | "monthly";
  digestEmail: string;
}

const WATCHED_BIAS_HINTS: Record<FormState["watchedBias"], string> = {
  balanced: "A mix of new titles and ones you've watched before.",
  new_to_me: "Favour titles you probably haven't watched yet.",
  include_favorites: "Also resurface titles you've watched and loved.",
};

const MOOD_OPTIONS = [
  "Cosy",
  "Feel-good",
  "Mind-bending",
  "Intense",
  "Dark",
  "Uplifting",
  "Nostalgic",
  "Suspenseful",
  "Funny",
  "Romantic",
  "Epic",
  "Gritty",
  "Heartwarming",
  "Thought-provoking",
  "Action-packed",
  "Relaxing",
  "Quirky",
  "Tear-jerker",
];

export default function PreferencesForm({ components: show }: { components: PortalComponents }) {
  const utils = portalTrpc.useUtils();
  const prefsQuery = portalTrpc.preferences.get.useQuery();
  const genresQuery = portalTrpc.availableGenres.useQuery();
  const setMutation = portalTrpc.preferences.set.useMutation();
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  /** The form as last loaded or saved, to tell an edit from a refetch. */
  const savedKey = useRef<string | null>(null);

  // Title search for the "never recommend" picker.
  const [titleQuery, setTitleQuery] = useState("");
  const debouncedTitle = useDebounced(titleQuery, 250);
  const titleResults = portalTrpc.searchTitles.useQuery(
    { q: debouncedTitle },
    { enabled: debouncedTitle.trim().length >= 2 },
  );

  useEffect(() => {
    if (!prefsQuery.data) return;
    const p = prefsQuery.data.preferences;
    const next: FormState = {
      loved: p.genres.loved,
      liked: p.genres.liked,
      hated: p.genres.hated,
      moods: p.moods,
      excludedTitles: p.excludedTitles,
      ratingFloor: p.ratingFloor != null ? String(p.ratingFloor) : "",
      rowCount: p.rowCount != null ? String(p.rowCount) : "",
      watchedBias: p.watchedBias,
      strictHate: p.strictHate,
      optedIn: prefsQuery.data.optedIn,
      digestFrequency: p.digest.frequency,
      digestEmail: p.digest.email,
    };
    savedKey.current = JSON.stringify(next);
    setForm(next);
  }, [prefsQuery.data]);

  /**
   * Saves as you go, the way a phone's settings do. There used to be a Save
   * button in a sticky bar, and an edit made on this tab was lost without a
   * word when you switched to another before pressing it. Debounced so a run
   * of taps on genre chips is one request, and skipped while the digest has
   * no address to send to — that is said beside the field instead.
   */
  useEffect(() => {
    if (!form || savedKey.current === null) return;
    const key = JSON.stringify(form);
    if (key === savedKey.current) return;
    setSaved(false);
    const missing = show["tastes.digest"] && form.digestFrequency !== "never" && !form.digestEmail.trim();
    if (missing) return;
    const timer = window.setTimeout(() => {
      savedKey.current = key;
      save();
    }, 700);
    return () => window.clearTimeout(timer);
    // `save` reads the latest form through the closure of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  if (prefsQuery.error) return <ErrorState message={prefsQuery.error.message} onRetry={() => prefsQuery.refetch()} />;
  if (!form) return <RowsSkeleton rows={5} />;

  const genres = genresQuery.data ?? [];
  const genreLevel = (g: string): GenreLevel =>
    form.loved.includes(g) ? "loved" : form.liked.includes(g) ? "liked" : form.hated.includes(g) ? "hated" : "none";

  const setGenre = (g: string, level: GenreLevel) =>
    setForm((f) => {
      if (!f) return f;
      const strip = (arr: string[]) => arr.filter((x) => x !== g);
      const next = { ...f, loved: strip(f.loved), liked: strip(f.liked), hated: strip(f.hated) };
      if (level === "loved") next.loved.push(g);
      else if (level === "liked") next.liked.push(g);
      else if (level === "hated") next.hated.push(g);
      return next;
    });

  const toggleMood = (m: string) =>
    setForm((f) => (f ? { ...f, moods: f.moods.includes(m) ? f.moods.filter((x) => x !== m) : [...f.moods, m] } : f));

  const addExcluded = (title: string) => {
    const t = title.trim();
    if (!t) return;
    setForm((f) => (f && !f.excludedTitles.includes(t) ? { ...f, excludedTitles: [...f.excludedTitles, t] } : f));
    setTitleQuery("");
  };
  const removeExcluded = (title: string) =>
    setForm((f) => (f ? { ...f, excludedTitles: f.excludedTitles.filter((x) => x !== title) } : f));

  function save() {
    if (!form) return;
    setSaved(false);
    // Only what the form shows. A hidden section is omitted rather than sent
    // as empty: `set` merges over what is stored, so the user's earlier answer
    // — a digest subscription made before SMTP went away, say — survives and is
    // back when the section is. The server drops hidden keys regardless.
    const preferences = {
      ...(show["tastes.genres"] && { genres: { loved: form.loved, liked: form.liked, hated: form.hated } }),
      ...(show["tastes.moods"] && { moods: form.moods }),
      ...(show["tastes.neverRecommend"] && { excludedTitles: form.excludedTitles }),
      ...(show["tastes.ratingFloor"] && {
        ratingFloor: Number(form.ratingFloor) > 0 ? Number(form.ratingFloor) : undefined,
      }),
      ...(show["tastes.rowCount"] && { rowCount: form.rowCount.trim() ? Number(form.rowCount) : undefined }),
      ...(show["tastes.watchedBias"] && { watchedBias: form.watchedBias }),
      ...(show["tastes.strictHate"] && { strictHate: form.strictHate }),
      ...(show["tastes.digest"] && {
        digest: {
          frequency: form.digestFrequency,
          // Cleared alongside the subscription: leaving an address stored
          // for someone who has just unsubscribed is the sort of thing that
          // makes people distrust an unsubscribe button.
          email: form.digestFrequency === "never" ? "" : form.digestEmail.trim(),
        },
      }),
    };
    setMutation.mutate(
      { optedIn: form.optedIn, preferences },
      {
        onSuccess: () => {
          setSaved(true);
          utils.preferences.get.invalidate();
        },
      },
    );
  }

  const suggestions = (titleResults.data ?? []).filter((t) => !form.excludedTitles.includes(t));
  // A subscription with nowhere to send it used to save silently and send
  // nothing; saying no at the button is the honest version of that.
  const emailMissing = show["tastes.digest"] && form.digestFrequency !== "never" && !form.digestEmail.trim();

  return (
    <div className="stack">
      <p className="autosave" aria-live="polite">
        {setMutation.isPending ? (
          "Saving…"
        ) : setMutation.error ? (
          <span className="err">Couldn't save: {setMutation.error.message}</span>
        ) : saved ? (
          "Saved"
        ) : (
          "Changes save automatically."
        )}
      </p>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={form.optedIn}
            onChange={(e) => setForm({ ...form, optedIn: e.target.checked })}
          />
          Personalize my home screen
        </label>
      </div>

      {show["tastes.genres"] && (
        <div className="field">
          <span className="field-label">Genres</span>
          <GenrePicker genres={genres} levelOf={genreLevel} onChange={setGenre} />
        </div>
      )}

      {show["tastes.moods"] && (
        <div className="field">
          <span className="field-label">Moods</span>
          <span className="field-hint">Recommendations lean toward these.</span>
          <div className="chips">
            {MOOD_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${form.moods.includes(m) ? "on" : ""}`}
                onClick={() => toggleMood(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {show["tastes.neverRecommend"] && (
        <div className="field">
          <span className="field-label">Never recommend</span>
          {form.excludedTitles.length > 0 && (
            <div className="pills">
              {form.excludedTitles.map((t) => (
                <span key={t} className="pill">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => removeExcluded(t)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="combo">
            <input
              type="text"
              enterKeyHint="done"
              autoCapitalize="none"
              autoCorrect="off"
              value={titleQuery}
              onFocus={() => setTitleFocused(true)}
              // After the tap on a suggestion has landed, not before it.
              onBlur={() => window.setTimeout(() => setTitleFocused(false), 150)}
              onChange={(e) => setTitleQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExcluded(titleQuery);
                }
              }}
              placeholder="Search titles…"
            />
            {titleFocused && suggestions.length > 0 && (
              <div className="combo-results">
                {suggestions.map((t) => (
                  <button key={t} type="button" onClick={() => addExcluded(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {show["tastes.ratingFloor"] && (
        <label className="field">
          <span className="field-label">Minimum rating</span>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={form.ratingFloor || "0"}
              onChange={(e) => setForm({ ...form, ratingFloor: e.target.value })}
            />
            <span className="slider-val">
              {Number(form.ratingFloor || 0) === 0 ? "Any" : Number(form.ratingFloor).toFixed(1)}
            </span>
          </div>
        </label>
      )}

      {show["tastes.rowCount"] && (
        <div className="field">
          <span className="field-label" id="rows-label">
            Rows on my home
          </span>
          {/* A stepper, not a number field: on a phone a number field is a
              keyboard for typing "7", where −/+ is two taps. */}
          <div className="stepper" role="group" aria-labelledby="rows-label">
            <button
              type="button"
              aria-label="Fewer rows"
              disabled={!form.rowCount || Number(form.rowCount) <= 1}
              onClick={() => setForm({ ...form, rowCount: String(Math.max(1, Number(form.rowCount || 1) - 1)) })}
            >
              −
            </button>
            <output aria-live="polite">{form.rowCount || "Auto"}</output>
            <button
              type="button"
              aria-label="More rows"
              disabled={Number(form.rowCount) >= 20}
              onClick={() => setForm({ ...form, rowCount: String(Math.min(20, Number(form.rowCount || 0) + 1)) })}
            >
              +
            </button>
          </div>
        </div>
      )}

      {show["tastes.watchedBias"] && (
        <div className="field">
          <span className="field-label">Watched bias</span>
          <select
            value={form.watchedBias}
            onChange={(e) => setForm({ ...form, watchedBias: e.target.value as FormState["watchedBias"] })}
            style={{ alignSelf: "flex-start" }}
          >
            <option value="balanced">Balanced</option>
            <option value="new_to_me">New to me</option>
            <option value="include_favorites">Include favourites</option>
          </select>
          <span className="field-hint">{WATCHED_BIAS_HINTS[form.watchedBias]}</span>
        </div>
      )}

      {show["tastes.strictHate"] && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={form.strictHate}
              onChange={(e) => setForm({ ...form, strictHate: e.target.checked })}
            />
            Never show genres I avoid
          </label>
          <span className="field-hint">Off, they're just shown less often.</span>
        </div>
      )}

      {show["tastes.digest"] && (
        <div className="field">
          <span className="field-label">Email digest</span>
          <span className="field-hint">What's new, what's popular, and what's leaving.</span>
          <select
            value={form.digestFrequency}
            onChange={(e) => setForm({ ...form, digestFrequency: e.target.value as FormState["digestFrequency"] })}
            style={{ alignSelf: "flex-start" }}
          >
            <option value="never">Never</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {form.digestFrequency !== "never" && (
            <input
              type="email"
              required
              aria-label="Digest email"
              aria-invalid={emailMissing}
              value={form.digestEmail}
              onChange={(e) => setForm({ ...form, digestEmail: e.target.value })}
              placeholder="you@example.com"
              style={{ marginTop: 8 }}
            />
          )}
          {emailMissing && <span className="field-hint">Add an address to get the digest, or choose Never.</span>}
        </div>
      )}
    </div>
  );
}
