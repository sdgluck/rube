"""
Vectors for titles nobody rated: TV, new releases, the long tail.

A title's Wikidata features (cast, creatives, genre, company, subject, …)
are mapped into the collaborative space by a ridge regression learned on the
films that have both. A series then lands near the films its cast, creators
and network are known for, which is the only signal there is for TV without
a ratings dataset.

The eval must never score a title with a projection that saw its own ALS
vector — rare tokens (a lead actor with three films) memorise — so
`out_of_fold` predicts each film from a model trained on the other folds.
That is the number that says how TV will fare.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold

# A token on fewer titles than this is noise to the projection: it can only
# memorise the one or two vectors it saw.
MIN_DF = 3
RIDGE_ALPHA = 1.0
FOLDS = 5


@dataclass
class Features:
    keys: list[str]  # row i of `matrix` is keys[i]
    row: dict[str, int]
    matrix: sp.csr_matrix  # TF-IDF, rows L2-normalised
    vocab: list[str]


def load(path: Path) -> pd.DataFrame:
    rows = [json.loads(line) for line in path.open()]
    df = pd.DataFrame(rows)
    df["features"] = df.apply(
        lambda r: sorted(
            set(r["features"]) | ({f"decade:{r['year'] // 10 * 10}"} if r["year"] else set())
        ),
        axis=1,
    )
    return df.drop_duplicates("key").reset_index(drop=True)


def featurise(items: pd.DataFrame) -> Features:
    keys = items["key"].tolist()
    df: dict[str, int] = {}
    for fs in items["features"]:
        for f in fs:
            df[f] = df.get(f, 0) + 1
    vocab = sorted(f for f, n in df.items() if n >= MIN_DF)
    col = {f: j for j, f in enumerate(vocab)}
    idf = np.log(len(keys) / np.array([df[f] for f in vocab], dtype=np.float64))

    indptr, indices, data = [0], [], []
    for fs in items["features"]:
        cols = sorted(col[f] for f in fs if f in col)
        indices.extend(cols)
        data.extend(idf[cols])
        indptr.append(len(indices))
    m = sp.csr_matrix((data, indices, indptr), shape=(len(keys), len(vocab)), dtype=np.float32)
    norms = np.sqrt(np.asarray(m.multiply(m).sum(axis=1)).ravel())
    m = sp.diags(1.0 / np.maximum(norms, 1e-9)) @ m
    return Features(keys=keys, row={k: i for i, k in enumerate(keys)}, matrix=m.tocsr(), vocab=vocab)


def fit(x: sp.csr_matrix, y: np.ndarray) -> Ridge:
    return Ridge(alpha=RIDGE_ALPHA, fit_intercept=True).fit(x, y)


def out_of_fold(x: sp.csr_matrix, y: np.ndarray, seed: int = 0) -> np.ndarray:
    """Every row's projection from a model that never saw that row."""
    out = np.zeros_like(y)
    for train, test in KFold(FOLDS, shuffle=True, random_state=seed).split(x):
        out[test] = fit(x[train], y[train]).predict(x[test])
    return out.astype(np.float32)
