"""
MovieLens 32M: the collaborative signal no single Plex server has.

A Tinkerbell install has a handful of viewers; MovieLens has 200k people and
32M ratings, linked to TMDb ids, which is what lets one shared model mean
something on every server.
"""

from __future__ import annotations

import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

URL = "https://files.grouplens.org/datasets/movielens/ml-32m.zip"


def ensure(data_dir: Path) -> Path:
    """The unpacked dataset directory, downloading it the first time."""
    root = data_dir / "ml-32m"
    if (root / "ratings.csv").exists():
        return root
    data_dir.mkdir(parents=True, exist_ok=True)
    archive = data_dir / "ml-32m.zip"
    if not archive.exists():
        print(f"downloading {URL}")
        urllib.request.urlretrieve(URL, archive)
    with zipfile.ZipFile(archive) as z:
        z.extractall(data_dir)
    return root


def load(root: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(ratings, movies). Movies carry their genre list and TMDb key."""
    ratings = pd.read_csv(
        root / "ratings.csv",
        dtype={"userId": "int32", "movieId": "int32", "rating": "float32", "timestamp": "int64"},
    )
    movies = pd.read_csv(root / "movies.csv", dtype={"movieId": "int32"})
    links = pd.read_csv(root / "links.csv", dtype={"movieId": "int32", "tmdbId": "Int64"})
    movies = movies.merge(links[["movieId", "tmdbId"]], on="movieId", how="left")
    movies["genres"] = movies["genres"].map(
        lambda g: [] if g == "(no genres listed)" else g.split("|")
    )
    # The `tmdb_cache` key shape, so Tinkerbell can join on what it already has.
    movies["key"] = movies["tmdbId"].map(lambda t: None if pd.isna(t) else f"movie:{int(t)}")
    return ratings, movies
