# ml — the shared recommender

Offline training for the item vectors that Because You Watched and We Think
You'd Like rank a library with. Nothing here runs in the app or ships in the
image. Rube downloads the published vectors and personalises them
locally from each person's plays, so no viewing data ever leaves a server.

Why train it centrally: a Plex server has a handful of viewers, which is too
few to learn which titles go together. MovieLens has 200k people.

## Setup

Python and uv are pinned in the repo's `mise.toml`.

```sh
cd ml
uv sync
uv run recs eval     # downloads MovieLens 32M (~240MB) on first run
```

## The gate

`recs eval` trains on everything before a cutoff and holds the test users out
of training entirely. It then folds those users in from their history, weighted
like `titleWeight` in the app, and scores what they went on to like against a
sampled 3,000-title library. A model is only worth publishing if it beats
`genre (fitLibrary)`, which is the ranking Rube already has without one.
`evaluate.py`'s header explains each choice.

## Content features

TV, new releases and films too little rated for MovieLens get their vectors
from Wikidata (CC0): cast, creatives, genre, network and subject, projected into
the collaborative space by a ridge regression learned on the films that have
both. TMDb is deliberately not used, because its API terms forbid training on
its content.

```sh
uv run recs fetch-wikidata   # ~1 minute, through QLever; cached under data/
```

`recs eval` scores the content projection out-of-fold alongside the
collaborative vectors. That is the number that says how TV will fare.

## Releasing a model

```sh
uv run recs build --version N   # trains on everything; writes out/ and pins models/recs.json
gh release create recs-vN out/recs-vN.bin --latest=false \
  --title "Recommender model vN" --notes "…"
git add models/recs.json        # the pin is what CI fetches and checks
```

The `.bin` is never committed. CI downloads the asset named in
`models/recs.json` before `docker build` and fails if it's missing or its sha
differs. `pnpm dev` fetches it too, but a missing model there only disables the
feature. `recs-v*` tags don't match the `v*` pattern that publishes images.
