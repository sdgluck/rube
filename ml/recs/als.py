"""
Collaborative item vectors: implicit ALS over MovieLens.

Implicit rather than explicit ALS because Rube never sees a rating —
only plays and how far they got — so the model is trained on "watched and
liked" as a confidence, the same shape of signal it will be queried with.

`fold_in` is the other half: a person's vector solved against fixed item
vectors. It is plain linear algebra on a 64×64 system, small enough to port to
the app as-is, so a server can personalise without ever training anything.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import scipy.sparse as sp
from implicit.cpu.als import AlternatingLeastSquares

FACTORS = 64
REGULARIZATION = 0.05
ALPHA = 2.0
ITERATIONS = 15
# Below this many raters a movie's factors are mostly regularisation noise.
MIN_RATERS = 20
# Training confidence is `rating - 2` (1..3); a history weight is at most 1 and
# decays with age. Scaling it up puts a fresh, liked title on the same footing
# as a well-rated one at training time.
FOLD_IN_SCALE = 3.0


@dataclass
class ItemModel:
    movie_ids: np.ndarray  # row i of `vectors` is movie_ids[i]
    vectors: np.ndarray  # (n_items, FACTORS) float32
    gram: np.ndarray  # YᵀY, which fold-in needs and the app can't afford to recompute per person
    regularization: float
    alpha: float


def confidence(rating: np.ndarray) -> np.ndarray:
    """Liked titles only; the training signal is "watched and would again"."""
    return np.where(rating >= 3.0, rating - 2.0, 0.0).astype(np.float32)


def train(ratings: pd.DataFrame) -> ItemModel:
    counts = ratings.groupby("movieId").size()
    keep = counts[counts >= MIN_RATERS].index.to_numpy()
    r = ratings[ratings["movieId"].isin(keep)]
    conf = confidence(r["rating"].to_numpy())
    r = r[conf > 0]
    conf = conf[conf > 0]

    users, user_index = np.unique(r["userId"].to_numpy(), return_inverse=True)
    movie_ids, item_index = np.unique(r["movieId"].to_numpy(), return_inverse=True)
    user_items = sp.csr_matrix(
        (conf, (user_index, item_index)), shape=(len(users), len(movie_ids)), dtype=np.float32
    )

    model = AlternatingLeastSquares(
        factors=FACTORS,
        regularization=REGULARIZATION,
        alpha=ALPHA,
        iterations=ITERATIONS,
        random_state=42,
    )
    model.fit(user_items)
    vectors = np.asarray(model.item_factors, dtype=np.float32)
    return ItemModel(
        movie_ids=movie_ids,
        vectors=vectors,
        gram=(vectors.T @ vectors).astype(np.float64),
        regularization=REGULARIZATION,
        alpha=ALPHA,
    )


def fold_in(model: ItemModel, rows: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """
    A person's vector from their weighted history, against fixed item vectors.

    The iALS normal equations: (YᵀY + Yᵀ(C−I)Y + λI) u = YᵀCp. A positive weight
    is a watched-and-liked title (p=1); a negative one is a title they gave up
    on, which iALS can say directly — p=0 at high confidence — so it pushes the
    vector away instead of being silently dropped.
    """
    if len(rows) == 0:
        return np.zeros(model.vectors.shape[1])
    y = model.vectors[rows].astype(np.float64)
    c = 1.0 + model.alpha * FOLD_IN_SCALE * np.abs(weights)
    p = (weights > 0).astype(np.float64)
    a = model.gram + (y.T * (c - 1.0)) @ y + model.regularization * np.eye(y.shape[1])
    b = y.T @ (c * p)
    return np.linalg.solve(a, b)
