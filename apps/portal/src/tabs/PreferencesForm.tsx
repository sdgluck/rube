import { useEffect, useState } from "react";
import { portalTrpc } from "../trpc.ts";
import { ErrorState, RowsSkeleton } from "../components/States.tsx";
import { useDebounced } from "../useDebounced.ts";

type GenreLevel = "none" | "loved" | "liked" | "hated";

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

const SEG_LABELS: Record<GenreLevel, string> = { loved: "Love", liked: "Like", hated: "Hate", none: "—" };

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

export default function PreferencesForm() {
  const utils = portalTrpc.useUtils();
  const prefsQuery = portalTrpc.preferences.get.useQuery();
  const genresQuery = portalTrpc.availableGenres.useQuery();
  const setMutation = portalTrpc.preferences.set.useMutation();
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);

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
    setForm({
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
    });
  }, [prefsQuery.data]);

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
    setMutation.mutate(
      {
        optedIn: form.optedIn,
        preferences: {
          genres: { loved: form.loved, liked: form.liked, hated: form.hated },
          moods: form.moods,
          excludedTitles: form.excludedTitles,
          ratingFloor: Number(form.ratingFloor) > 0 ? Number(form.ratingFloor) : undefined,
          rowCount: form.rowCount.trim() ? Number(form.rowCount) : undefined,
          watchedBias: form.watchedBias,
          strictHate: form.strictHate,
          digest: {
            frequency: form.digestFrequency,
            // Cleared alongside the subscription: leaving an address stored
            // for someone who has just unsubscribed is the sort of thing that
            // makes people distrust an unsubscribe button.
            email: form.digestFrequency === "never" ? "" : form.digestEmail.trim(),
          },
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          utils.preferences.get.invalidate();
        },
      },
    );
  }

  const suggestions = (titleResults.data ?? []).filter((t) => !form.excludedTitles.includes(t));

  return (
    <div className="stack">
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={form.optedIn}
            onChange={(e) => setForm({ ...form, optedIn: e.target.checked })}
          />
          Personalize my home screen
        </label>
        <span className="field-hint">Master switch for your account — turn your saved preferences on or off.</span>
      </div>

      <div className="field">
        <span className="field-label">Genres</span>
        <span className="field-hint">
          Rate the genres in your library so we show more of what you love and less of what you don't. Love = lots more
          · Like = a bit more · Hate = keep away.
        </span>
        <div className="genre-box">
          {genres.length === 0 && <div className="genre-row muted">No genres available.</div>}
          {genres.map((g) => {
            const level = genreLevel(g);
            return (
              <div key={g} className="genre-row">
                <span>{g}</span>
                <span className="seg">
                  {(["loved", "liked", "hated", "none"] as GenreLevel[]).map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      className={`${lv} ${level === lv ? "on" : ""}`}
                      onClick={() => setGenre(g, lv)}
                    >
                      {SEG_LABELS[lv]}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Moods</span>
        <span className="field-hint">Pick the moods you're in for — recommendations will lean toward them.</span>
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

      <div className="field">
        <span className="field-label">Never recommend</span>
        <span className="field-hint">Search your library and add titles you never want suggested.</span>
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
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExcluded(titleQuery);
              }
            }}
            placeholder="Search titles…"
          />
          {suggestions.length > 0 && (
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

      <label className="field">
        <span className="field-label">Minimum rating</span>
        <span className="field-hint">Only suggest titles rated at least this high. Set to "Any" for no limit.</span>
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

      <label className="field narrow">
        <span className="field-label">Rows on my home</span>
        <span className="field-hint">How many personalized rows to add to your Plex home screen.</span>
        <input
          type="number"
          min={1}
          max={20}
          value={form.rowCount}
          onChange={(e) => setForm({ ...form, rowCount: e.target.value })}
        />
      </label>

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

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={form.strictHate}
            onChange={(e) => setForm({ ...form, strictHate: e.target.checked })}
          />
          Strictly avoid my hated genres
        </label>
        <span className="field-hint">
          When on, hated genres are never included. When off, they're just shown less often.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Email digest</span>
        <span className="field-hint">
          A summary of what's been added, what people have been watching, and anything about to be removed. Only sent to
          the address you enter here, and you can stop it at any time by choosing “Never”.
        </span>
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
          <>
            <input
              type="email"
              value={form.digestEmail}
              onChange={(e) => setForm({ ...form, digestEmail: e.target.value })}
              placeholder="you@example.com"
              style={{ marginTop: 8 }}
            />
            <span className="field-hint">
              Used for this digest and nothing else. Leave it blank and no email is sent.
            </span>
          </>
        )}
      </div>

      <div className="save-row">
        <button type="button" className="btn-primary" onClick={save} disabled={setMutation.isPending}>
          {setMutation.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="ok">Saved ✓</span>}
        {setMutation.error && <span className="err">{setMutation.error.message}</span>}
      </div>
    </div>
  );
}
