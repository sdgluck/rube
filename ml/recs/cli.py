"""`uv run recs eval` — the gate before a model is worth publishing."""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import pandas as pd

import numpy as np

from . import als, content, evaluate, export, mixed, movielens, wikidata

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(prog="recs")
    sub = parser.add_subparsers(dest="command", required=True)
    ev = sub.add_parser("eval", help="temporal-holdout eval against the genre baseline")
    ev.add_argument("--cutoff", type=float, default=0.95, help="timestamp quantile to split at")
    sub.add_parser("eval-mixed", help="rated and rarely-rated titles in one library: does the tail crowd out good picks?")
    build = sub.add_parser("build", help="train on everything and write the published file + manifest")
    build.add_argument("--version", type=int, required=True)
    pin = sub.add_parser("pin", help="point models/recs.json at a built version and place it for local use")
    pin.add_argument("--version", type=int, required=True)
    sub.add_parser("fixture", help="rewrite the tiny model the app's tests parse")
    sub.add_parser("fetch-wikidata", help="content features for films and TV (resumable)")
    args = parser.parse_args()

    if args.command == "pin":
        _pin(args.version)
        return

    if args.command == "fixture":
        _fixture()
        return

    if args.command == "fetch-wikidata":
        print(wikidata.fetch(ROOT / "data"))
        return

    root = movielens.ensure(ROOT / "data")
    started = time.time()
    ratings, movies = movielens.load(root)
    print(f"loaded {len(ratings):,} ratings in {time.time() - started:.0f}s")

    if args.command == "eval":
        features = None
        wd = ROOT / "data" / "wikidata" / "wikidata.jsonl"
        if wd.exists():
            features = content.featurise(content.load(wd))
            print(f"{len(features.keys):,} Wikidata items, {len(features.vocab):,} feature tokens")
        with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 120):
            print(evaluate.evaluate(ratings, movies, args.cutoff, features))
        print(f"done in {time.time() - started:.0f}s")

    if args.command == "eval-mixed":
        features = content.featurise(content.load(wikidata.fetch(ROOT / "data")))
        with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200, "display.max_columns", 20):
            print(mixed.evaluate_mixed(ratings, movies, features))
        print(f"done in {time.time() - started:.0f}s")

    if args.command == "build":
        _build(ratings, movies, args.version)
        print(f"done in {time.time() - started:.0f}s")


FIXTURE_DIR = ROOT.parent / "domains" / "recommendations" / "src" / "__fixtures__"
JOBS_FIXTURE_DIR = ROOT.parent / "packages" / "jobs" / "src" / "commands" / "__fixtures__"


def _fixture() -> None:
    """
    Seven hand-placed 4-d vectors, so the app's tests can assert a ranking by
    reading the numbers — and so the TypeScript parser is tested against a file
    Python wrote, not against a TypeScript writer that shares its mistakes.
    """
    vectors = {
        "movie:1": [1.0, 0.0, 0.0, 0.0],
        "movie:2": [0.9, 0.1, 0.0, 0.0],
        "movie:3": [0.0, 1.0, 0.0, 0.0],
        "movie:4": [0.0, 0.0, 1.0, 0.0],
        "movie:5": [0.1, 0.0, 0.0, 1.0],
        "tv:10": [0.8, 0.0, 0.2, 0.0],
        # Perfectly aligned with movie:1 but short — a thin, low-confidence
        # projection. Cosine ranks it first; the app must not.
        "movie:6": [0.3, 0.0, 0.0, 0.0],
    }
    published = export.Published(
        keys=list(vectors),
        vectors=np.array(list(vectors.values()), dtype=np.float32),
        source=np.array([0, 0, 0, 0, 0, 1, 1], dtype=np.uint8),
        regularization=0.05,
        alpha=2.0,
        fold_in_scale=3.0,
    )
    _write_fixture(published, FIXTURE_DIR / "tiny.bin")

    # The jobs' integration tests: twenty films in two clusters, 0–9 and
    # 10–19, as `movie:1000`… — someone who watched 0–5 should be offered 6–9
    # before anything from the other cluster.
    films = np.zeros((20, 4), dtype=np.float32)
    for i in range(10):
        films[i] = [1.0, 0.05 * i, 0.0, 0.0]
        films[10 + i] = [0.0, 0.0, 1.0, 0.05 * i]
    _write_fixture(
        export.Published(
            keys=[f"movie:{1000 + i}" for i in range(20)],
            vectors=films,
            source=np.zeros(20, dtype=np.uint8),
            regularization=0.05,
            alpha=2.0,
            fold_in_scale=3.0,
        ),
        JOBS_FIXTURE_DIR / "films.bin",
    )


def _write_fixture(published: "export.Published", target: Path) -> None:
    path = export.write(published, 0, target.parent, "https://example.invalid")
    (target.parent / "manifest.json").unlink()
    path.rename(target)
    print(target)


# Release assets rather than the site: at ~25MB the file is too big to commit,
# and a tag per model version keeps every published file reachable.
RELEASE_URL = "https://github.com/sdgluck/rube/releases/download/recs-v{version}"


def _build(ratings: pd.DataFrame, movies: pd.DataFrame, version: int) -> None:
    model = als.train(ratings)
    key_of = movies.set_index("movieId")["key"].reindex(model.movie_ids)
    cf = {k: model.vectors[i] for i, k in enumerate(key_of) if isinstance(k, str)}
    print(f"{len(cf):,} films with collaborative vectors")

    items = content.load(wikidata.fetch(ROOT / "data"))
    features = content.featurise(items)
    both = [k for k in features.keys if k in cf]
    projection = content.fit(
        features.matrix[[features.row[k] for k in both]], np.stack([cf[k] for k in both])
    )
    cold = [k for k in features.keys if k not in cf]
    projected = projection.predict(features.matrix[[features.row[k] for k in cold]]).astype(np.float32)
    print(f"projection trained on {len(both):,} films, applied to {len(cold):,} titles")

    keys = list(cf) + cold
    published = export.Published(
        keys=keys,
        vectors=np.concatenate([np.stack(list(cf.values())), projected]),
        source=np.array([export.SOURCE_COLLABORATIVE] * len(cf) + [export.SOURCE_CONTENT] * len(cold)),
        regularization=model.regularization,
        alpha=model.alpha,
        fold_in_scale=als.FOLD_IN_SCALE,
    )
    path = export.write(published, version, ROOT / "out", RELEASE_URL.format(version=version))
    header, read_keys, _, _, vectors = export.read(path)
    assert read_keys == sorted(keys) and vectors.shape == (len(keys), header["dims"])
    print(f"{path} ({path.stat().st_size / 1e6:.1f} MB): {header['sources']}")
    _pin(version)


MODELS_DIR = ROOT.parent / "models"


def _pin(version: int) -> None:
    """
    `models/recs.json` is what the app's source and the model agree on: CI and
    `scripts/fetch-recs-model.mjs` download the release asset it names and
    check its sha. Also copies the file into place so `pnpm dev` uses it
    without a download. Publishing the release itself is a separate, manual
    `gh release create` — see ml/README.md.
    """
    manifest = json.loads((ROOT / "out" / "manifest.json").read_text())
    assert manifest["version"] == version, f"out/ holds v{manifest['version']}, not v{version}"
    pin = {
        "version": version,
        "tag": f"recs-v{version}",
        "asset": f"recs-v{version}.bin",
        "sha256": manifest["sha256"],
        "bytes": manifest["bytes"],
        "count": manifest["count"],
        "license": manifest["license"],
        "attribution": manifest["attribution"],
    }
    MODELS_DIR.mkdir(exist_ok=True)
    (MODELS_DIR / "recs.json").write_text(json.dumps(pin, indent=2) + "\n")
    shutil.copyfile(ROOT / "out" / pin["asset"], MODELS_DIR / "recs.bin")
    print(f"models/recs.json pins v{version} ({pin['sha256'][:12]}…)")


if __name__ == "__main__":
    main()
