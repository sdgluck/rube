"""
Content features from Wikidata: what TV and new releases are made of.

MovieLens only says what films go together, and only for films enough people
rated, so on its own it covers no TV at all. Content features fill that gap.

They come from Wikidata rather than TMDb because TMDb's API terms forbid using
its content to train a model (§1.C, §2.A). Wikidata is CC0, and its film and TV
items carry TMDb ids (P4947 and P4983), so they join on the keys Tinkerbell
already stores.

Fetched from QLever (University of Freiburg's SPARQL engine over a recent
Wikidata dump), one bulk query per property. The first version batched 300
items per query against query.wikidata.org: ~2,300 queries, throttled with
two-minute 429 back-offs after a few dozen, on course for most of a day.
QLever returns a property's 1.2M rows for every film in under two seconds.
Each result is cached as a TSV, so a rerun refetches nothing.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

import requests

ENDPOINT = "https://qlever.dev/api/wikidata"
USER_AGENT = "TinkerbellRecs/0.1 (https://github.com/sdgluck/tinkerbell; offline recommender training)"
ENTITY = "<http://www.wikidata.org/entity/"

# Property → feature field. Roles are grouped across film and TV on purpose:
# a TV "creator" and a film "director" both become `creative`, a broadcaster
# and a distributor both become `company`. The projection is learned on films
# only, so a field TV has and films don't would carry no weight at all.
FIELDS: dict[str, str] = {
    "P136": "genre",
    "P161": "cast",
    "P57": "creative",  # director
    "P58": "creative",  # screenwriter
    "P170": "creative",  # creator
    "P162": "crew",  # producer
    "P86": "crew",  # composer
    "P344": "crew",  # director of photography
    "P1040": "crew",  # film editor
    "P449": "company",  # original broadcaster
    "P750": "company",  # distributed by
    "P272": "company",  # production company
    "P495": "country",
    "P364": "language",
    "P921": "subject",
    "P144": "basedon",
    "P179": "series",
    "P840": "setting",
    "P2408": "period",
}

KINDS = {"movie": "P4947", "tv": "P4983"}
# Publication date for films, start time for series; the earlier wins.
YEAR_PROPS = ("P577", "P580")

PREFIX = "PREFIX wdt: <http://www.wikidata.org/prop/direct/>\n"


def _query(session: requests.Session, cache: Path, sparql: str) -> list[list[str]]:
    """Rows of a TSV result, header dropped; cached at `cache`."""
    if not cache.exists():
        for attempt in range(5):
            try:
                res = session.get(ENDPOINT, params={"query": PREFIX + sparql}, timeout=300)
            except (requests.ConnectionError, requests.Timeout) as err:
                print(f"  {type(err).__name__}, retrying")
                time.sleep(2 ** (attempt + 2))
                continue
            if res.status_code == 200:
                cache.write_text(res.text)
                break
            if res.status_code in (429, 500, 502, 503, 504):
                time.sleep(int(res.headers.get("Retry-After", 0)) or 2 ** (attempt + 2))
                continue
            res.raise_for_status()
        else:
            raise RuntimeError(f"QLever kept refusing {cache.name}; try again later")
    lines = cache.read_text().splitlines()[1:]
    return [line.split("\t") for line in lines if line]


def _qid(term: str) -> str | None:
    """`Q123` from `<http://www.wikidata.org/entity/Q123>`; None for a literal or another IRI."""
    return term[len(ENTITY) : -1] if term.startswith(ENTITY) else None


def _literal(term: str) -> str:
    """The value of a TSV literal: `"2010"^^<…#int>` or a bare `2010`."""
    return term.split("^^")[0].strip('"')


def fetch(data_dir: Path) -> Path:
    """`wikidata.jsonl`: one `{key, qid, year, features}` per film and series."""
    root = data_dir / "wikidata"
    cache = root / "qlever"
    cache.mkdir(parents=True, exist_ok=True)
    final = root / "wikidata.jsonl"
    if final.exists():
        return final

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/tab-separated-values"})

    key_of: dict[str, str] = {}
    features: dict[str, set[str]] = defaultdict(set)
    years: dict[str, int] = {}
    for kind, prop in KINDS.items():
        rows = _query(session, cache / f"{kind}-ids.tsv", f"SELECT ?item ?tmdb WHERE {{ ?item wdt:{prop} ?tmdb }}")
        for item, tmdb in rows:
            if (q := _qid(item)) is not None:
                # An item with both properties (rare) keeps the last; Plex's own
                # type decides at lookup time anyway.
                key_of[q] = f"{kind}:{_literal(tmdb)}"
        print(f"{len(rows):,} {kind} items")

        for p, field in FIELDS.items():
            got = _query(
                session,
                cache / f"{kind}-{p}.tsv",
                f"SELECT ?item ?v WHERE {{ ?item wdt:{prop} ?t . ?item wdt:{p} ?v }}",
            )
            for item, v in got:
                q, value = _qid(item), _qid(v)
                if q is not None and value is not None:
                    features[q].add(f"{field}:{value}")
            print(f"  {kind} {p} ({field}): {len(got):,} rows")

        for p in YEAR_PROPS:
            got = _query(
                session,
                cache / f"{kind}-{p}.tsv",
                f"SELECT ?item (MIN(YEAR(?d)) AS ?year) WHERE {{ ?item wdt:{prop} ?t . ?item wdt:{p} ?d }} GROUP BY ?item",
            )
            for item, year in got:
                q = _qid(item)
                try:
                    y = int(float(_literal(year)))
                except ValueError:
                    continue
                if q is not None and 1880 <= y <= 2100:
                    years[q] = min(years.get(q, y), y)

    with final.open("w") as f:
        for q, key in sorted(key_of.items()):
            f.write(json.dumps({"key": key, "qid": q, "year": years.get(q), "features": sorted(features[q])}) + "\n")
    return final
