import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createPosterCache } from "./cache.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "posters-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function mockFetch(responses: Array<Response | (() => Response)>): typeof fetch {
  let i = 0;
  return (async (..._args: unknown[]) => {
    const r = responses[i++];
    if (!r) throw new Error("mockFetch exhausted");
    return typeof r === "function" ? r() : r;
  }) as typeof fetch;
}

function jpeg(bytes = 4): ArrayBuffer {
  return new Uint8Array(Array.from({ length: bytes }, (_, i) => i + 1)).buffer as ArrayBuffer;
}

function bytes(arr: number[]): ArrayBuffer {
  return new Uint8Array(arr).buffer as ArrayBuffer;
}

test("first call fetches, second call hits disk cache", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(jpeg(), { status: 200, headers: { etag: '"v1"' } });
  }) as typeof fetch;

  const cache = createPosterCache({ dir, fetchImpl });
  const first = await cache.getOrFetch("https://example.com/a.jpg");
  const second = await cache.getOrFetch("https://example.com/a.jpg");

  assert.equal(first.status, "ok");
  assert.equal(first.fromCache, false);
  assert.equal(second.status, "ok");
  assert.equal(second.fromCache, true);
  assert.equal(calls, 1);
});

test("404 is negative-cached for the TTL", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("", { status: 404 });
  }) as typeof fetch;

  const cache = createPosterCache({ dir, fetchImpl });
  const a = await cache.getOrFetch("https://example.com/missing.jpg");
  const b = await cache.getOrFetch("https://example.com/missing.jpg");

  assert.equal(a.status, "missing");
  assert.equal(a.fromCache, false);
  assert.equal(b.status, "missing");
  assert.equal(b.fromCache, true);
  assert.equal(calls, 1);
});

test("negative cache expires after TTL", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("", { status: 404 });
  }) as typeof fetch;

  let t = 0;
  const cache = createPosterCache({ dir, fetchImpl, now: () => t });
  await cache.getOrFetch("https://example.com/missing.jpg");
  t = 25 * 60 * 60 * 1000;
  await cache.getOrFetch("https://example.com/missing.jpg");

  assert.equal(calls, 2);
});

test("refresh sends If-None-Match and accepts 304", async () => {
  let receivedHeaders: Headers | undefined;
  const responses: Array<() => Response> = [
    () => new Response(jpeg(), { status: 200, headers: { etag: '"v1"' } }),
    () =>
      ({
        status: 304,
        ok: false,
        headers: new Headers(),
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }) as unknown as Response,
  ];
  let i = 0;
  const fetchImpl = (async (_url: string, init?: { headers?: HeadersInit }) => {
    receivedHeaders = new Headers(init?.headers ?? {});
    return responses[i++]();
  }) as typeof fetch;

  const cache = createPosterCache({ dir, fetchImpl });
  await cache.getOrFetch("https://example.com/a.jpg");
  const refreshed = await cache.refresh("https://example.com/a.jpg");

  assert.equal(refreshed.status, "ok");
  assert.equal(refreshed.fromCache, true);
  assert.equal(receivedHeaders?.get("if-none-match"), '"v1"');
});

test("refresh replaces blob when upstream changes", async () => {
  const v1 = jpeg(4);
  const v2 = bytes([9, 9, 9, 9, 9, 9]);
  const responses = [
    new Response(v1, { status: 200, headers: { etag: '"v1"' } }),
    new Response(v2, { status: 200, headers: { etag: '"v2"' } }),
  ];
  const cache = createPosterCache({ dir, fetchImpl: mockFetch(responses) });
  await cache.getOrFetch("https://example.com/a.jpg");
  const refreshed = await cache.refresh("https://example.com/a.jpg");

  assert.equal(refreshed.status, "ok");
  assert.equal(refreshed.fromCache, false);
  if (refreshed.status === "ok") {
    assert.deepEqual(new Uint8Array(refreshed.buffer), new Uint8Array(v2));
  }
});

test("non-200/304/404 throws", async () => {
  const cache = createPosterCache({
    dir,
    fetchImpl: mockFetch([new Response("nope", { status: 500 })]),
  });
  await assert.rejects(() => cache.getOrFetch("https://example.com/a.jpg"), /500/);
});

test("cache miss when blob is gone but sidecar remains", async () => {
  const responses = [new Response(jpeg(), { status: 200 }), new Response(jpeg(8), { status: 200 })];
  const cache = createPosterCache({ dir, fetchImpl: mockFetch(responses) });
  const first = await cache.getOrFetch("https://example.com/a.jpg");
  assert.equal(first.status, "ok");

  // Simulate disk eviction: drop the .jpg blob, keep the sidecar
  const { readdir, unlink } = await import("node:fs/promises");
  for (const f of await readdir(dir)) {
    if (f.endsWith(".jpg")) await unlink(join(dir, f));
  }

  const second = await cache.getOrFetch("https://example.com/a.jpg");
  assert.equal(second.status, "ok");
  assert.equal(second.fromCache, false);
});

test("refreshAll iterates cached sidecars and counts outcomes", async () => {
  // Seed three URLs with distinct outcomes on refresh:
  //   ok url    → 200 fresh bytes (updated)
  //   nochange  → 304 (unchanged)
  //   gone      → 404 (was ok, now removed)
  const seedResponses = [
    new Response(jpeg(4), { status: 200, headers: { etag: '"v1"' } }),
    new Response(jpeg(4), { status: 200, headers: { etag: '"v1"' } }),
    new Response(jpeg(4), { status: 200, headers: { etag: '"v1"' } }),
  ];
  const refreshResponses: Array<() => Response> = [
    () => new Response(jpeg(8), { status: 200, headers: { etag: '"v2"' } }),
    () =>
      ({
        status: 304,
        ok: false,
        headers: new Headers(),
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }) as unknown as Response,
    () => new Response("", { status: 404 }),
  ];

  let phase: "seed" | "refresh" = "seed";
  let seedI = 0;
  let refreshI = 0;
  const fetchImpl = (async () => {
    if (phase === "seed") return seedResponses[seedI++];
    return refreshResponses[refreshI++]();
  }) as typeof fetch;

  const cache = createPosterCache({ dir, fetchImpl });
  await cache.getOrFetch("https://example.com/updated.jpg");
  await cache.getOrFetch("https://example.com/unchanged.jpg");
  await cache.getOrFetch("https://example.com/gone.jpg");

  phase = "refresh";
  const summary = await cache.refreshAll();

  assert.equal(summary.total, 3);
  assert.equal(summary.updated, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.failed, 0);
});

test("refreshAll returns empty summary for empty/missing dir", async () => {
  const cache = createPosterCache({
    dir: join(dir, "does-not-exist"),
    fetchImpl: mockFetch([]),
  });
  const summary = await cache.refreshAll();
  assert.equal(summary.total, 0);
});

test("refreshAll counts thrown fetches as failed", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) return new Response(jpeg(), { status: 200 });
    throw new Error("network down");
  }) as typeof fetch;

  const cache = createPosterCache({ dir, fetchImpl });
  await cache.getOrFetch("https://example.com/a.jpg");
  const summary = await cache.refreshAll();

  assert.equal(summary.total, 1);
  assert.equal(summary.failed, 1);
});

test("clear removes the cache directory", async () => {
  const cache = createPosterCache({
    dir,
    fetchImpl: mockFetch([new Response(jpeg(), { status: 200 })]),
  });
  await cache.getOrFetch("https://example.com/a.jpg");
  await cache.clear();

  const { readdir } = await import("node:fs/promises");
  await assert.rejects(() => readdir(dir));
});

test("written blob round-trips byte-for-byte", async () => {
  const payload = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const cache = createPosterCache({
    dir,
    fetchImpl: mockFetch([new Response(payload, { status: 200 })]),
  });
  const result = await cache.getOrFetch("https://example.com/a.jpg");
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    const onDisk = await readFile(
      join(
        dir,
        `${(await import("node:crypto")).createHash("sha256").update("https://example.com/a.jpg").digest("hex")}.jpg`,
      ),
    );
    assert.deepEqual(new Uint8Array(onDisk), new Uint8Array(payload));
    assert.deepEqual(new Uint8Array(result.buffer), new Uint8Array(payload));
  }
});
