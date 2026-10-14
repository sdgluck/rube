"""
The published model: one binary file plus a manifest that points at it.

Layout (little-endian), chosen so the app can read it with typed-array views
and no parser dependency:

    "TBRV"                      magic
    uint32                      header length in bytes
    header                      UTF-8 JSON (see `HEADER` below), space-padded to a multiple of 8
    keys                        UTF-8, "\\n"-joined, `keysBytes` long, sorted, padded to 8
    gram   float64[dims*dims]   YᵀY over the published vectors, for fold-in
    scale  float32[count]       per-vector dequantisation factor
    source uint8[count]         0 = collaborative, 1 = content projection
    vector int8[count*dims]     vector i = vector[i*dims:(i+1)*dims] * scale[i]

The gram is computed from the *dequantised* vectors so fold-in in the app
solves exactly the system the file describes. Keys are the `tmdb_cache` shape
(`movie:550`, `tv:1399`).

MovieLens' licence lets transformations be redistributed under the same
terms, for non-commercial use, with attribution — so the licence travels in
the header and the manifest rather than living only in this repo.
"""

from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MAGIC = b"TBRV"
SOURCE_COLLABORATIVE = 0
SOURCE_CONTENT = 1

ATTRIBUTION = (
    "Collaborative signal derived from the MovieLens 32M dataset (F. Maxwell Harper and "
    "Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4: 19), "
    "used under its licence: non-commercial use only, no endorsement by the University of "
    "Minnesota or GroupLens implied, redistributed under the same conditions. Content features "
    "from Wikidata (CC0)."
)


@dataclass
class Published:
    keys: list[str]
    vectors: np.ndarray  # float32 (count, dims)
    source: np.ndarray  # uint8 (count,)
    regularization: float
    alpha: float
    fold_in_scale: float


def _pad(b: bytes, fill: bytes = b"\0") -> bytes:
    return b + fill * (-len(b) % 8)


def quantise(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scale = np.maximum(np.abs(vectors).max(axis=1), 1e-12) / 127.0
    q = np.clip(np.round(vectors / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def write(p: Published, version: int, out_dir: Path, url_base: str) -> Path:
    order = np.argsort(np.array(p.keys))
    keys = [p.keys[i] for i in order]
    q, scale = quantise(p.vectors[order])
    source = p.source[order].astype(np.uint8)
    dequantised = q.astype(np.float64) * scale[:, None]
    gram = dequantised.T @ dequantised
    count, dims = q.shape

    keys_bytes = "\n".join(keys).encode()
    header = {
        "format": 1,
        "version": version,
        "dims": dims,
        "count": count,
        "keysBytes": len(keys_bytes),
        "regularization": p.regularization,
        "alpha": p.alpha,
        "foldInScale": p.fold_in_scale,
        "sources": {
            "collaborative": int((source == SOURCE_COLLABORATIVE).sum()),
            "content": int((source == SOURCE_CONTENT).sum()),
        },
        "license": "MovieLens non-commercial research licence; Wikidata CC0",
        "attribution": ATTRIBUTION,
    }
    header_bytes = _pad(json.dumps(header, separators=(",", ":")).encode(), b" ")

    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"recs-v{version}.bin"
    path = out_dir / name
    with path.open("wb") as f:
        f.write(MAGIC + struct.pack("<I", len(header_bytes)))
        f.write(header_bytes)
        f.write(_pad(keys_bytes))
        f.write(gram.astype("<f8").tobytes())
        f.write(_pad(scale.astype("<f4").tobytes()))
        f.write(_pad(source.tobytes()))
        f.write(q.tobytes())

    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {
        "version": version,
        "url": f"{url_base}/{name}",
        "sha256": sha,
        "bytes": path.stat().st_size,
        "dims": dims,
        "count": count,
        "license": header["license"],
        "attribution": ATTRIBUTION,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return path


def read(path: Path) -> tuple[dict, list[str], np.ndarray, np.ndarray, np.ndarray]:
    """(header, keys, gram, source, vectors) — the round-trip the app's parser must match."""
    buf = path.read_bytes()
    assert buf[:4] == MAGIC, "not a recommender vectors file"
    (hlen,) = struct.unpack_from("<I", buf, 4)
    off = 8
    header = json.loads(buf[off : off + hlen])
    off += hlen
    keys = buf[off : off + header["keysBytes"]].decode().split("\n")
    off += header["keysBytes"] + (-header["keysBytes"] % 8)
    count, dims = header["count"], header["dims"]
    gram = np.frombuffer(buf, "<f8", dims * dims, off).reshape(dims, dims)
    off += dims * dims * 8
    scale = np.frombuffer(buf, "<f4", count, off)
    off += count * 4 + (-(count * 4) % 8)
    source = np.frombuffer(buf, np.uint8, count, off)
    off += count + (-count % 8)
    q = np.frombuffer(buf, np.int8, count * dims, off).reshape(count, dims)
    return header, keys, gram, source, q.astype(np.float32) * scale[:, None]
