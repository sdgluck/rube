import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";

type GenreLevel = "none" | "loved" | "liked" | "hated";

interface FormState {
  loved: string[];
  liked: string[];
  hated: string[];
  moods: string;
  excludedTitles: string;
  ratingFloor: string;
  contentRatingCeiling: string;
  rowCount: string;
  watchedBias: "new_to_me" | "include_favorites" | "balanced";
  strictHate: boolean;
  optedIn: boolean;
}

const EMPTY: FormState = {
  loved: [],
  liked: [],
  hated: [],
  moods: "",
  excludedTitles: "",
  ratingFloor: "",
  contentRatingCeiling: "",
  rowCount: "",
  watchedBias: "balanced",
  strictHate: true,
  optedIn: false,
};

function linesToArray(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function SettingsPreferences() {
  const { addToast } = useToast();
  const usersQuery = trpc.users.list.useQuery({ offset: 0, limit: 200, sortDir: "asc" });
  const sharingStatusQuery = trpc.personalization.status.useQuery();
  const availableGenresQuery = trpc.preferences.availableGenres.useQuery(undefined, { staleTime: 5 * 60_000 });
  const setMutation = trpc.preferences.set.useMutation();

  const [userId, setUserId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const prefsQuery = trpc.preferences.get.useQuery({ userId: userId ?? 0 }, { enabled: userId != null });

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
      contentRatingCeiling: p.contentRatingCeiling ?? "",
      rowCount: p.rowCount != null ? String(p.rowCount) : "",
      watchedBias: p.watchedBias,
      strictHate: p.strictHate,
      optedIn: prefsQuery.data.optedIn,
    });
  }, [prefsQuery.data]);

  function genreLevel(g: string): GenreLevel {
    if (form.loved.includes(g)) return "loved";
    if (form.liked.includes(g)) return "liked";
    if (form.hated.includes(g)) return "hated";
    return "none";
  }

  function setGenre(g: string, level: GenreLevel) {
    setForm((f) => {
      const strip = (arr: string[]) => arr.filter((x) => x !== g);
      const next = { ...f, loved: strip(f.loved), liked: strip(f.liked), hated: strip(f.hated) };
      if (level === "loved") next.loved = [...next.loved, g];
      else if (level === "liked") next.liked = [...next.liked, g];
      else if (level === "hated") next.hated = [...next.hated, g];
      return next;
    });
  }

  function save() {
    if (userId == null) return;
    const ratingFloor = form.ratingFloor.trim() ? Number(form.ratingFloor) : undefined;
    const rowCount = form.rowCount.trim() ? Number(form.rowCount) : undefined;
    setMutation.mutate(
      {
        userId,
        optedIn: form.optedIn,
        preferences: {
          genres: { loved: form.loved, liked: form.liked, hated: form.hated },
          moods: linesToArray(form.moods),
          excludedTitles: linesToArray(form.excludedTitles),
          ratingFloor,
          contentRatingCeiling: form.contentRatingCeiling.trim() || undefined,
          rowCount,
          watchedBias: form.watchedBias,
          strictHate: form.strictHate,
        },
      },
      {
        onSuccess: () => addToast("Preferences saved", "success"),
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  const sharingEnabled = sharingStatusQuery.data?.status === "enabled";
  const users = usersQuery.data?.items ?? [];
  const genres = availableGenresQuery.data ?? [];

  return (
    <div>
      <h3>User Preferences</h3>
      <p>
        Set a user's taste preferences. These shape their personalized recommendations (Because You Watched and any
        rules marked personalizable). They only take effect once the user is opted in and Personalized Home Screens is
        enabled.
      </p>

      {!sharingEnabled && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Personalized Home Screens is not enabled — preferences are stored but won't change anyone's home screen until
          you enable it under Settings → Personalization.
        </p>
      )}

      <label style={{ display: "block", margin: "16px 0" }}>
        <span style={{ display: "block", marginBottom: 4 }}>User</span>
        <select
          value={userId ?? ""}
          onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
          style={{ minWidth: 240 }}
        >
          <option value="">Select a user…</option>
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.username}
            </option>
          ))}
        </select>
      </label>

      {userId != null && prefsQuery.data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.optedIn}
              onChange={(e) => setForm({ ...form, optedIn: e.target.checked })}
            />
            Opted in to personalization
          </label>

          <section>
            <strong>Genres</strong>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 8 }}>
              Love = strongly favour · Like = lean towards · Hate = avoid
            </div>
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                padding: 8,
              }}
            >
              {genres.length === 0 && (
                <span style={{ color: "var(--text-muted)" }}>No genres found in your libraries.</span>
              )}
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
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 6px",
                            opacity: level === lv ? 1 : 0.45,
                            fontWeight: level === lv ? 700 : 400,
                          }}
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

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label>
              <span style={{ display: "block", marginBottom: 4 }}>Min rating (0–10)</span>
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
              <span style={{ display: "block", marginBottom: 4 }}>Max content rating</span>
              <input
                type="text"
                value={form.contentRatingCeiling}
                onChange={(e) => setForm({ ...form, contentRatingCeiling: e.target.value })}
                placeholder="PG-13"
                style={{ width: 120 }}
              />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 4 }}>Rows on home</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.rowCount}
                onChange={(e) => setForm({ ...form, rowCount: e.target.value })}
                style={{ width: 120 }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
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
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
              <input
                type="checkbox"
                checked={form.strictHate}
                onChange={(e) => setForm({ ...form, strictHate: e.target.checked })}
              />
              Strictly exclude hated genres
            </label>
          </div>

          <div>
            <button type="button" onClick={save} disabled={setMutation.isPending}>
              {setMutation.isPending ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
