"""
The library a real server has: mostly well-rated films, plus some nobody rated.

`evaluate.py` scores collaborative and content vectors each on their own, and
both pass. What it never did is put them in one library, and the first
published model showed why that matters. A title with a thin Wikidata entry
projects to roughly the *average* film vector, and the average points the same
way as popular films, so obscure titles ranked as close to everything:
Inception's third-nearest neighbour was *Tarantella* (1990).

So here each library is 2,700 rated films plus 300 rarely-rated ones (1–19
ratings: in the catalogue, absent from the ALS model, given content
projections), and two things are measured:

- **hit/recall/NDCG@20** against what people really went on to like, which
  falls if tail titles crowd out good picks;
- **tail share**: how much of the top 20 is tail, against how much of what
  people actually liked was.

Two remedies are compared: `shrink`, which scales content vectors down so a
thin projection reads as low confidence under a dot product, and BYW scoring
by dot product with the seed's direction (`seed·item/|seed|`) rather than
cosine, which ignores length altogether.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pandas as pd

from . import als, content
from .evaluate import K, metrics, split
from .weights import title_weight

LIBRARY_WARM = 2700
LIBRARY_TAIL = 300
LIBRARIES = 3
# The first run compared 1.0, 0.5 and 0.25: identical to three places for both
# features, so the published vectors aren't shrunk.
SHRINKS = (1.0,)
# BYW's score is cosine × length^β: 0 is cosine, 1 is a dot product with the
# seed's direction. Dot removed the tail and won on hit@20, but ranked by
# popularity as much as likeness — The Matrix's neighbours became Shawshank
# and Forrest Gump — so the values between are measured too.
#
# Measured: β=0.5 keeps the tail out (0%, as dot does) and most of dot's
# hit@20 (0.174 against 0.191, cosine 0.128) at a quarter less popularity skew
# — that is what `similar` in domains/recommendations ships.
BETAS = (0.0, 0.25, 0.5, 1.0)


def evaluate_mixed(ratings: pd.DataFrame, movies: pd.DataFrame, features: content.Features) -> pd.DataFrame:
    s = split(ratings, 0.95, seed=1)
    model = als.train(s.train)
    key_of = movies.set_index("movieId")["key"]

    def frow(movie_ids: np.ndarray) -> np.ndarray:
        return np.array([features.row.get(k, -1) if isinstance(k, str) else -1 for k in key_of.reindex(movie_ids)])

    warm_frow = frow(model.movie_ids)
    warm_ok = warm_frow >= 0
    warm_ids = model.movie_ids[warm_ok]
    warm_vecs = model.vectors[warm_ok]
    projection = content.fit(features.matrix[warm_frow[warm_ok]], warm_vecs)

    counts = s.train.groupby("movieId").size()
    tail_ids = counts[(counts > 0) & (counts < als.MIN_RATERS)].index.to_numpy()
    tail_frow = frow(tail_ids)
    tail_ids = tail_ids[tail_frow >= 0]
    tail_vecs = projection.predict(features.matrix[tail_frow[tail_frow >= 0]]).astype(np.float32)
    print(f"{len(warm_ids):,} rated films, {len(tail_ids):,} rarely-rated films with content vectors")

    ids = np.concatenate([warm_ids, tail_ids])
    n_warm, n = len(warm_ids), len(ids)
    is_tail = np.arange(n) >= n_warm
    row_of = {int(m): i for i, m in enumerate(ids)}
    popularity = counts.reindex(ids, fill_value=0).to_numpy().astype(np.float64)

    # One model per shrink, plus the collaborative-only baseline in which tail
    # titles have no vector and so can never be shortlisted — today's app.
    def model_with(vectors: np.ndarray) -> als.ItemModel:
        return dataclasses.replace(model, vectors=vectors, gram=(vectors.T @ vectors).astype(np.float64))

    variants = {f"shrink {k}": model_with(np.concatenate([warm_vecs, k * tail_vecs])) for k in SHRINKS}
    collab_only = model_with(warm_vecs)

    histories = {u: h for u, h in s.history.groupby("userId")}
    targets = {u: set(t["movieId"].map(row_of).dropna().astype(int)) for u, t in s.targets.groupby("userId")}

    rows: list[dict] = []
    for lib in range(LIBRARIES):
        rng = np.random.default_rng(200 + lib)
        p = np.sqrt(popularity[:n_warm])
        library = np.concatenate(
            [
                rng.choice(n_warm, size=LIBRARY_WARM, replace=False, p=p / p.sum()),
                n_warm + rng.choice(n - n_warm, size=LIBRARY_TAIL, replace=False),
            ]
        )

        for user, h in histories.items():
            hr = h["movieId"].map(row_of)
            known = hr.notna().to_numpy()
            hist = hr[known].astype(int).to_numpy()
            if len(hist) == 0:
                continue
            relevant = (targets.get(user, set()) & set(library.tolist())) - set(hist.tolist())
            if not relevant:
                continue
            w = title_weight(h["rating"].to_numpy()[known], h["timestamp"].to_numpy()[known], s.cutoff)
            candidates = library[~np.isin(library, hist)]
            warm_hist = hist < n_warm
            liked = np.flatnonzero((w > 0) & warm_hist)
            seed = hist[liked[np.argmax(h["timestamp"].to_numpy()[known][liked])]] if len(liked) else None

            def record(name: str, scores: np.ndarray, pool: np.ndarray) -> None:
                ranked = pool[np.argsort(-scores, kind="stable")]
                hit, recall, ndcg = metrics(ranked, relevant)
                rows.append(
                    {
                        "method": name,
                        "hit": hit,
                        "recall": recall,
                        "ndcg": ndcg,
                        "tail@20": float(is_tail[ranked[:K]].mean()),
                        "tail in truth": float(np.mean([is_tail[i] for i in relevant])),
                        # How much the top 20 leans to the already-popular.
                        "median pop@20": float(np.median(popularity[ranked[:K]])),
                    }
                )

            warm_pool = candidates[candidates < n_warm]
            if warm_hist.any():
                u = als.fold_in(collab_only, hist[warm_hist], w[warm_hist])
                record("WTYL collaborative only", collab_only.vectors[warm_pool] @ u, warm_pool)
            for name, m in variants.items():
                record(f"WTYL {name}", m.vectors[candidates] @ als.fold_in(m, hist, w), candidates)

            if seed is not None:
                sv = warm_vecs[seed]
                su = sv / np.linalg.norm(sv)
                wu = warm_vecs[warm_pool] / np.linalg.norm(warm_vecs[warm_pool], axis=1, keepdims=True)
                record("BYW collaborative only", wu @ su, warm_pool)
                for name, m in variants.items():
                    v = m.vectors[candidates]
                    norms = np.maximum(np.linalg.norm(v, axis=1), 1e-9)
                    for beta in BETAS:
                        record(f"BYW {name}, β={beta}", (v @ su) / norms ** (1 - beta), candidates)

    out = pd.DataFrame(rows)
    summary = out.groupby("method").mean()
    summary["people"] = out.groupby("method").size() // LIBRARIES
    return summary.sort_values("ndcg", ascending=False)
