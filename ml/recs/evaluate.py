"""
Does the model beat what Rube does without it? A model is only worth
publishing if this says yes.

The setup mirrors a Plex server rather than a recsys benchmark:

- **Temporal split.** Everything before a cutoff is history, the next weeks are
  what the person actually went on to like. Random splits leak the future.
- **Held-out people.** Test users are left out of training entirely and folded
  in from their history, because no Rube user is in MovieLens either.
- **A sampled library.** Ranking against all 85k movies is not the job; ranking
  a few thousand titles someone happens to own is. Libraries skew popular, so
  they are drawn proportional to sqrt(popularity).
- **Weighted like the app.** History weights come from `weights.py`, a port of
  `titleWeight`, including the negative weight for a title given up on.

The genre baseline is the scoring `fitLibrary` uses to cut a library down. It
stands in for "no model"; the LLM itself is not evaluated here.

With Wikidata features, a second scenario replaces every film's vector with
its out-of-fold content projection — the position every TV series is in, since
no TV has ratings. Both scenarios rank the same libraries for the same people,
restricted to films that have features, so the rows compare directly.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import dataclasses

from . import als, content
from .weights import DAY_S, title_weight

K = 20
LIBRARY_SIZE = 3000
TEST_USERS = 5000
HISTORY_DAYS = 365
TARGET_DAYS = 60
LIBRARIES = 3


@dataclass
class Split:
    train: pd.DataFrame
    history: pd.DataFrame  # test users, the window before the cutoff
    targets: pd.DataFrame  # test users, liked in the window after it
    cutoff: int


def split(ratings: pd.DataFrame, cutoff_quantile: float, seed: int) -> Split:
    cutoff = int(ratings["timestamp"].quantile(cutoff_quantile))
    before = ratings[ratings["timestamp"] < cutoff]
    history = before[before["timestamp"] >= cutoff - HISTORY_DAYS * DAY_S]
    after = ratings[
        (ratings["timestamp"] >= cutoff) & (ratings["timestamp"] < cutoff + TARGET_DAYS * DAY_S)
    ]
    targets = after[after["rating"] >= 4.0]

    hist_counts = history.groupby("userId").size()
    eligible = np.intersect1d(hist_counts[hist_counts >= 5].index, targets["userId"].unique())
    rng = np.random.default_rng(seed)
    test = rng.choice(eligible, size=min(TEST_USERS, len(eligible)), replace=False)

    return Split(
        train=before[~before["userId"].isin(test)],
        history=history[history["userId"].isin(test)],
        targets=targets[targets["userId"].isin(test)],
        cutoff=cutoff,
    )


def metrics(ranked: np.ndarray, relevant: set[int]) -> tuple[float, float, float]:
    """(hit@K, recall@K, NDCG@K) for one person."""
    top = ranked[:K]
    gains = np.array([1.0 if i in relevant else 0.0 for i in top])
    dcg = float((gains / np.log2(np.arange(2, len(top) + 2))).sum())
    ideal = float((1.0 / np.log2(np.arange(2, min(len(relevant), K) + 2))).sum())
    return float(gains.any()), gains.sum() / min(len(relevant), K), dcg / ideal if ideal else 0.0


def evaluate(
    ratings: pd.DataFrame,
    movies: pd.DataFrame,
    cutoff_quantile: float = 0.95,
    features: content.Features | None = None,
) -> pd.DataFrame:
    s = split(ratings, cutoff_quantile, seed=1)
    print(
        f"cutoff {pd.Timestamp(s.cutoff, unit='s').date()}: "
        f"{len(s.train):,} training ratings, {s.history['userId'].nunique():,} test people"
    )
    model = als.train(s.train)
    n = len(model.movie_ids)
    row_of = {int(m): i for i, m in enumerate(model.movie_ids)}

    scenarios = {"collaborative": model}
    usable = np.ones(n, dtype=bool)
    if features is not None:
        keys = movies.set_index("movieId")["key"].reindex(model.movie_ids)
        frow = np.array([features.row.get(k, -1) if isinstance(k, str) else -1 for k in keys])
        usable = frow >= 0
        print(f"{usable.sum():,} of {n:,} rated films have Wikidata features")
        projected = np.zeros_like(model.vectors)
        projected[usable] = content.out_of_fold(features.matrix[frow[usable]], model.vectors[usable])
        scenarios["content"] = dataclasses.replace(
            model, vectors=projected, gram=(projected.T @ projected).astype(np.float64)
        )
    units = {
        name: m.vectors / np.maximum(np.linalg.norm(m.vectors, axis=1, keepdims=True), 1e-9)
        for name, m in scenarios.items()
    }

    popularity = s.train.groupby("movieId").size().reindex(model.movie_ids, fill_value=0).to_numpy()
    genres_of = movies.set_index("movieId")["genres"].reindex(model.movie_ids).map(
        lambda g: g if isinstance(g, list) else []
    )
    genre_names = sorted({g for gs in genres_of for g in gs})
    genre_col = {g: j for j, g in enumerate(genre_names)}
    genre_matrix = np.zeros((n, len(genre_names)), dtype=np.float32)
    for i, gs in enumerate(genres_of):
        for g in gs:
            genre_matrix[i, genre_col[g]] = 1.0

    histories = {u: h for u, h in s.history.groupby("userId")}
    targets = {u: set(t["movieId"].map(row_of).dropna().astype(int)) for u, t in s.targets.groupby("userId")}

    rows: list[dict] = []
    for lib in range(LIBRARIES):
        rng = np.random.default_rng(100 + lib)
        p = np.sqrt(popularity.astype(np.float64)) * usable
        library = rng.choice(n, size=LIBRARY_SIZE, replace=False, p=p / p.sum())
        in_library = np.zeros(n, dtype=bool)
        in_library[library] = True

        for user, h in histories.items():
            hist_rows = h["movieId"].map(row_of)
            known = (hist_rows.notna() & hist_rows.map(lambda r: r == r and usable[int(r)])).to_numpy()
            hist_rows = hist_rows[known].astype(int).to_numpy()
            if len(hist_rows) == 0:
                continue
            relevant = {i for i in targets.get(user, set()) if in_library[i]} - set(hist_rows)
            if not relevant:
                continue
            w = title_weight(h["rating"].to_numpy()[known], h["timestamp"].to_numpy()[known], s.cutoff)
            candidates = library[~np.isin(library, hist_rows)]

            # Genre shares of the positive weight — `buildTasteProfile` — scored
            # per title by summing them, as `fitLibrary` does.
            genre_scores = (genre_matrix[hist_rows] * w[:, None]).sum(axis=0)
            genre_scores = np.where(genre_scores > 0, genre_scores, 0)
            if genre_scores.sum() > 0:
                genre_scores /= genre_scores.sum()

            # The most recent liked title stands in for BYW's seed.
            liked = np.flatnonzero(w > 0)
            ts = h["timestamp"].to_numpy()[known]
            seed = hist_rows[liked[np.argmax(ts[liked])]] if len(liked) else None

            scorers = {
                "popularity": popularity[candidates].astype(np.float64),
                "genre (fitLibrary)": genre_matrix[candidates] @ genre_scores + 1e-9 * popularity[candidates],
            }
            for name, m in scenarios.items():
                unit = units[name]
                scorers[f"{name}: fold-in"] = m.vectors[candidates] @ als.fold_in(m, hist_rows, w)
                scorers[f"{name}: weighted mean"] = unit[candidates] @ (unit[hist_rows] * w[:, None]).sum(axis=0)
                if seed is not None:
                    scorers[f"BYW {name}: similarity"] = unit[candidates] @ unit[seed]
            if seed is not None:
                seed_genres = genre_matrix[seed]
                overlap = genre_matrix[candidates] @ seed_genres
                union = genre_matrix[candidates].sum(axis=1) + seed_genres.sum() - overlap
                scorers["BYW: genre overlap"] = overlap / np.maximum(union, 1) + 1e-9 * popularity[candidates]

            for name, scores in scorers.items():
                ranked = candidates[np.argsort(-scores, kind="stable")]
                hit, recall, ndcg = metrics(ranked, relevant)
                rows.append({"method": name, "library": lib, "hit": hit, "recall": recall, "ndcg": ndcg})

    out = pd.DataFrame(rows)
    summary = out.groupby("method")[["hit", "recall", "ndcg"]].mean()
    summary["people"] = out.groupby("method").size() // LIBRARIES
    return summary.sort_values("ndcg", ascending=False)
