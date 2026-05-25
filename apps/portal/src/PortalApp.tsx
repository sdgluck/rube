import { useEffect, useState } from "react";
import { portalTrpc } from "./trpc.ts";
import { getPortalIcon } from "./portalIcons.ts";

const PIN_KEY = "tb_pin";

interface Branding {
  title?: string;
  icon?: string;
  iconColor?: string;
  backgroundImage?: string;
}

function BrandHeader({ branding, size = 26 }: { branding: Branding; size?: number }) {
  const Icon = getPortalIcon(branding.icon);
  return (
    <span className="brand-head">
      <Icon size={size} color={branding.iconColor || "#e5a00d"} />
      <span>{branding.title?.trim() || "Tinkerbell"}</span>
    </span>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function PortalApp() {
  const utils = portalTrpc.useUtils();
  const meQuery = portalTrpc.me.useQuery(undefined, { retry: false });
  const startMutation = portalTrpc.auth.start.useMutation();
  const pollMutation = portalTrpc.auth.poll.useMutation();
  const logoutMutation = portalTrpc.auth.logout.useMutation();
  const brandingQuery = portalTrpc.branding.useQuery();
  const branding: Branding = brandingQuery.data ?? {};
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<boolean>(() => !!localStorage.getItem(PIN_KEY));

  // Apply the admin's background image to the page.
  useEffect(() => {
    const bg = branding.backgroundImage?.trim();
    const { style } = document.body;
    if (bg) {
      style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url("${bg}")`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
      style.backgroundAttachment = "fixed";
    } else {
      style.backgroundImage = "";
    }
    return () => {
      style.backgroundImage = "";
    };
  }, [branding.backgroundImage]);

  // After returning from Plex, finish the handshake by polling the pin.
  useEffect(() => {
    const pinId = localStorage.getItem(PIN_KEY);
    if (!pinId) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts++;
      try {
        const res = await pollMutation.mutateAsync({ id: Number(pinId) });
        if (res.status === "ok") {
          localStorage.removeItem(PIN_KEY);
          setFinishing(false);
          await utils.me.invalidate();
          return;
        }
      } catch (e) {
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        return;
      }
      if (!cancelled && attempts < 60) setTimeout(tick, 2000);
      else {
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
    // Run once on mount; the pin id is read from storage inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    setError(null);
    startMutation.mutate(
      { forwardUrl: window.location.origin },
      {
        onSuccess: ({ id, authUrl }) => {
          localStorage.setItem(PIN_KEY, String(id));
          window.location.href = authUrl;
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className="page">
        <div className="card muted">Loading…</div>
      </div>
    );
  }

  if (!meQuery.data) {
    return (
      <div className="page">
        <div className="card">
          <h1 className="brand">
            <BrandHeader branding={branding} size={32} />
          </h1>
          <p className="lede">Sign in with your Plex account to personalize your home screen.</p>
          <button type="button" className="btn-plex" onClick={signIn} disabled={startMutation.isPending || finishing}>
            {finishing ? "Finishing sign-in…" : startMutation.isPending ? "Redirecting…" : "Sign in with Plex"}
          </button>
          {error && <p className="err">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row-between">
          <h1 className="title">
            <BrandHeader branding={branding} />
          </h1>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => utils.me.reset() })}
          >
            Sign out ({meQuery.data.username})
          </button>
        </div>
        <PreferencesForm />
      </div>
    </div>
  );
}

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

function PreferencesForm() {
  const utils = portalTrpc.useUtils();
  const statusQuery = portalTrpc.personalizationStatus.useQuery();
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
    });
  }, [prefsQuery.data]);

  if (!form) return <p className="muted">Loading your preferences…</p>;

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
      {statusQuery.data !== "enabled" && (
        <p className="banner">
          Personalized home screens aren't switched on yet. Your choices are saved and will apply once the server admin
          enables them.
        </p>
      )}

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
