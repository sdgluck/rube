import { useEffect, useState } from "react";
import { portalTrpc } from "./trpc.ts";

const PIN_KEY = "tb_pin";

const wrap: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
};

export default function PortalApp() {
  const utils = portalTrpc.useUtils();
  const meQuery = portalTrpc.me.useQuery(undefined, { retry: false });
  const startMutation = portalTrpc.auth.start.useMutation();
  const pollMutation = portalTrpc.auth.poll.useMutation();
  const logoutMutation = portalTrpc.auth.logout.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<boolean>(() => !!localStorage.getItem(PIN_KEY));

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
    return <div style={wrap}>Loading…</div>;
  }

  if (!meQuery.data) {
    return (
      <div style={wrap}>
        <h1>Tinkerbell</h1>
        <p>Sign in with your Plex account to personalize your home screen.</p>
        <button type="button" onClick={signIn} disabled={startMutation.isPending || finishing}>
          {finishing ? "Finishing sign-in…" : startMutation.isPending ? "Redirecting…" : "Sign in with Plex"}
        </button>
        {error && <p style={{ color: "#c0392b" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Your recommendations</h1>
        <button
          type="button"
          onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => utils.me.invalidate() })}
        >
          Sign out ({meQuery.data.username})
        </button>
      </div>
      <PreferencesForm />
    </div>
  );
}

type GenreLevel = "none" | "loved" | "liked" | "hated";

interface FormState {
  loved: string[];
  liked: string[];
  hated: string[];
  moods: string;
  excludedTitles: string;
  ratingFloor: string;
  rowCount: string;
  watchedBias: "new_to_me" | "include_favorites" | "balanced";
  strictHate: boolean;
  optedIn: boolean;
}

function linesToArray(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function PreferencesForm() {
  const utils = portalTrpc.useUtils();
  const statusQuery = portalTrpc.personalizationStatus.useQuery();
  const prefsQuery = portalTrpc.preferences.get.useQuery();
  const genresQuery = portalTrpc.availableGenres.useQuery();
  const setMutation = portalTrpc.preferences.set.useMutation();
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!prefsQuery.data) return;
    const p = prefsQuery.data.preferences;
    setForm({
      loved: p.genres.loved,
      liked: p.genres.liked,
      hated: p.genres.hated,
      moods: p.moods.join(", "),
      excludedTitles: p.excludedTitles.join("\n"),
      ratingFloor: p.ratingFloor != null ? String(p.ratingFloor) : "",
      rowCount: p.rowCount != null ? String(p.rowCount) : "",
      watchedBias: p.watchedBias,
      strictHate: p.strictHate,
      optedIn: prefsQuery.data.optedIn,
    });
  }, [prefsQuery.data]);

  if (!form) return <p>Loading your preferences…</p>;

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

  function save() {
    if (!form) return;
    setSaved(false);
    setMutation.mutate(
      {
        optedIn: form.optedIn,
        preferences: {
          genres: { loved: form.loved, liked: form.liked, hated: form.hated },
          moods: linesToArray(form.moods),
          excludedTitles: linesToArray(form.excludedTitles),
          ratingFloor: form.ratingFloor.trim() ? Number(form.ratingFloor) : undefined,
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
      {statusQuery.data !== "enabled" && (
        <p style={{ fontSize: "0.85rem", color: "#9a6700" }}>
          Personalized home screens aren't switched on yet. Your choices are saved and will apply once the server admin
          enables them.
        </p>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={form.optedIn}
          onChange={(e) => setForm({ ...form, optedIn: e.target.checked })}
        />
        Personalize my home screen
      </label>

      <section>
        <strong>Genres</strong>
        <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: 8 }}>
          Love = show me more · Like = a bit more · Hate = keep away
        </div>
        <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #ccc", borderRadius: 6, padding: 8 }}>
          {genres.length === 0 && <span style={{ color: "#666" }}>No genres available.</span>}
          {genres.map((g) => {
            const level = genreLevel(g);
            return (
              <div
                key={g}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}
              >
                <span>{g}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  {(["loved", "liked", "hated", "none"] as GenreLevel[]).map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setGenre(g, lv)}
                      style={{ fontSize: "0.72rem", padding: "2px 6px", opacity: level === lv ? 1 : 0.45 }}
                    >
                      {lv === "none" ? "—" : lv === "loved" ? "Love" : lv === "liked" ? "Like" : "Hate"}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <label>
        <span style={{ display: "block", marginBottom: 4 }}>Moods (comma-separated)</span>
        <input
          type="text"
          value={form.moods}
          onChange={(e) => setForm({ ...form, moods: e.target.value })}
          style={{ width: "100%" }}
          placeholder="cosy, mind-bending, feel-good"
        />
      </label>

      <label>
        <span style={{ display: "block", marginBottom: 4 }}>Never recommend (one per line)</span>
        <textarea
          value={form.excludedTitles}
          onChange={(e) => setForm({ ...form, excludedTitles: e.target.value })}
          rows={3}
          style={{ width: "100%" }}
        />
      </label>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label>
          <span style={{ display: "block", marginBottom: 4 }}>Minimum rating (0–10)</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={form.ratingFloor}
            onChange={(e) => setForm({ ...form, ratingFloor: e.target.value })}
            style={{ width: 120 }}
          />
        </label>
        <label>
          <span style={{ display: "block", marginBottom: 4 }}>Rows on my home</span>
          <input
            type="number"
            min={1}
            max={20}
            value={form.rowCount}
            onChange={(e) => setForm({ ...form, rowCount: e.target.value })}
            style={{ width: 120 }}
          />
        </label>
        <label>
          <span style={{ display: "block", marginBottom: 4 }}>Watched bias</span>
          <select
            value={form.watchedBias}
            onChange={(e) => setForm({ ...form, watchedBias: e.target.value as FormState["watchedBias"] })}
          >
            <option value="balanced">Balanced</option>
            <option value="new_to_me">New to me</option>
            <option value="include_favorites">Include favourites</option>
          </select>
        </label>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={form.strictHate}
          onChange={(e) => setForm({ ...form, strictHate: e.target.checked })}
        />
        Strictly avoid my hated genres
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={save} disabled={setMutation.isPending}>
          {setMutation.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ color: "#2e7d32" }}>Saved ✓</span>}
        {setMutation.error && <span style={{ color: "#c0392b" }}>{setMutation.error.message}</span>}
      </div>
    </div>
  );
}
