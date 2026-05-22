import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DAY_MS } from "@tinkerbell/core";

type Sidecar = {
  url: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  status: "ok" | "missing";
};

export type RefreshSummary = {
  total: number;
  unchanged: number;
  updated: number;
  removed: number;
  missing: number;
  failed: number;
};

const NEGATIVE_TTL_MS = DAY_MS;

export type FetchResult =
  | { status: "ok"; buffer: Buffer; fromCache: boolean }
  | { status: "missing"; fromCache: boolean };

export type RefreshProgress = {
  current: number;
  total: number;
  url: string;
};

export type RefreshAllOptions = {
  signal?: AbortSignal;
  onProgress?: (info: RefreshProgress) => void;
};

export type PosterCache = {
  getOrFetch: (url: string) => Promise<FetchResult>;
  refresh: (url: string) => Promise<FetchResult>;
  refreshAll: (opts?: RefreshAllOptions) => Promise<RefreshSummary>;
  clear: () => Promise<void>;
};

export type PosterCacheOptions = {
  dir: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function keyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

async function readSidecar(path: string): Promise<Sidecar | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Sidecar;
  } catch {
    return null;
  }
}

async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function createPosterCache(opts: PosterCacheOptions): PosterCache {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let ensured = false;

  async function ensureDir(): Promise<void> {
    if (ensured) return;
    await mkdir(opts.dir, { recursive: true });
    ensured = true;
  }

  function paths(url: string) {
    const key = keyFor(url);
    return {
      blob: join(opts.dir, `${key}.jpg`),
      meta: join(opts.dir, `${key}.json`),
    };
  }

  async function fetchFresh(
    url: string,
    prior: Sidecar | null,
    blobPath: string,
    metaPath: string,
  ): Promise<FetchResult> {
    const headers: Record<string, string> = {};
    if (prior?.etag) headers["If-None-Match"] = prior.etag;
    if (prior?.lastModified) headers["If-Modified-Since"] = prior.lastModified;

    const res = await fetchImpl(url, { headers });

    if (res.status === 304 && prior?.status === "ok") {
      const buffer = await readFile(blobPath);
      await writeAtomic(metaPath, JSON.stringify({ ...prior, fetchedAt: now() }));
      return { status: "ok", buffer, fromCache: true };
    }

    if (res.status === 404) {
      const sidecar: Sidecar = { url, status: "missing", fetchedAt: now() };
      await writeAtomic(metaPath, JSON.stringify(sidecar));
      return { status: "missing", fromCache: false };
    }

    if (!res.ok) {
      throw new Error(`Poster fetch ${url} → ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sidecar: Sidecar = {
      url,
      status: "ok",
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      fetchedAt: now(),
    };
    await writeAtomic(blobPath, buffer);
    await writeAtomic(metaPath, JSON.stringify(sidecar));
    return { status: "ok", buffer, fromCache: false };
  }

  async function getOrFetch(url: string): Promise<FetchResult> {
    await ensureDir();
    const { blob, meta } = paths(url);
    const sidecar = await readSidecar(meta);

    if (sidecar?.status === "ok") {
      try {
        const buffer = await readFile(blob);
        return { status: "ok", buffer, fromCache: true };
      } catch {
        // sidecar references a missing blob — fall through and refetch
      }
    }

    if (sidecar?.status === "missing" && now() - sidecar.fetchedAt < NEGATIVE_TTL_MS) {
      return { status: "missing", fromCache: true };
    }

    return fetchFresh(url, sidecar, blob, meta);
  }

  async function refresh(url: string): Promise<FetchResult> {
    await ensureDir();
    const { blob, meta } = paths(url);
    const sidecar = await readSidecar(meta);
    return fetchFresh(url, sidecar, blob, meta);
  }

  async function refreshAll(refreshOpts: RefreshAllOptions = {}): Promise<RefreshSummary> {
    const { readdir } = await import("node:fs/promises");
    const summary: RefreshSummary = {
      total: 0,
      unchanged: 0,
      updated: 0,
      removed: 0,
      missing: 0,
      failed: 0,
    };

    let entries: string[];
    try {
      entries = await readdir(opts.dir);
    } catch {
      return summary;
    }

    type Pending = { sidecar: Sidecar; metaPath: string; blobPath: string };
    const pending: Pending[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const metaPath = join(opts.dir, entry);
      const sidecar = await readSidecar(metaPath);
      if (!sidecar?.url) continue;
      pending.push({
        sidecar,
        metaPath,
        blobPath: join(opts.dir, `${entry.slice(0, -5)}.jpg`),
      });
    }

    summary.total = pending.length;
    let i = 0;
    for (const { sidecar, metaPath, blobPath } of pending) {
      if (refreshOpts.signal?.aborted) break;
      i++;
      refreshOpts.onProgress?.({ current: i, total: pending.length, url: sidecar.url });

      try {
        const result = await fetchFresh(sidecar.url, sidecar, blobPath, metaPath);
        if (result.status === "missing") {
          if (sidecar.status === "ok") summary.removed++;
          else summary.missing++;
        } else if (result.fromCache) {
          summary.unchanged++;
        } else {
          summary.updated++;
        }
      } catch {
        summary.failed++;
      }
    }

    return summary;
  }

  async function clear(): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(opts.dir, { recursive: true, force: true });
    ensured = false;
  }

  return { getOrFetch, refresh, refreshAll, clear };
}
