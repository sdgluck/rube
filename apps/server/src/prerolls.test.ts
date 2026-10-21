/**
 * `Range` handling, which is off-by-one country and had no tests.
 *
 * The `<video>` element issues a range request on every seek, so this runs
 * constantly and its failures are strange rather than loud: a byte dropped at
 * the boundary corrupts the frame at a seek point, an inclusive/exclusive
 * mix-up makes Safari refuse the source outright, and an unsatisfiable range
 * answered with a 200 makes a player loop the first chunk for ever.
 *
 * The branch most likely to be wrong is the suffix form. `bytes=-500` means
 * *the last 500 bytes*, not "from zero to 500" — and it is the one form a
 * reader skims past, because it looks like a range with an empty start.
 *
 * Driven over a real `node:http` server against a real file: the assertions
 * are about status codes, `Content-Range`, `Content-Length` and the actual
 * bytes returned, none of which a stub would tell the truth about.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { serveFile } from "./prerolls.ts";

/** 1000 bytes, each the low byte of its own offset, so a slice is checkable. */
const SIZE = 1000;
const CONTENT = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));

let dir: string;
let filePath: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rube-preroll-"));
  filePath = join(dir, "clip.mp4");
  writeFileSync(filePath, CONTENT);

  server = createServer((req, res) => {
    const path = req.url === "/missing" ? join(dir, "nope.mp4") : req.url === "/dir" ? dir : filePath;
    void serveFile(req, res, path, "video/mp4").catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});

function get(range?: string, path = "/"): Promise<Response> {
  return fetch(`${base}${path}`, {
    headers: range ? { Range: range } : undefined,
    signal: AbortSignal.timeout(5_000),
  });
}

const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe("a whole-file request", () => {
  test("returns 200 with the whole file", async () => {
    const res = await get();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(SIZE));
    assert.deepEqual(await bytesOf(res), CONTENT);
  });

  test("advertises range support, which Safari requires before it will play", async () => {
    const res = await get();
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    await res.arrayBuffer();
  });

  test("carries the content type and refuses sniffing", async () => {
    const res = await get();
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    await res.arrayBuffer();
  });

  test("is cached privately — a preroll's file never changes in place", async () => {
    const res = await get();
    assert.match(res.headers.get("cache-control") ?? "", /private/);
    await res.arrayBuffer();
  });
});

describe("a closed range", () => {
  test("returns exactly the requested bytes, inclusive at both ends", async () => {
    // `bytes=0-99` is 100 bytes, not 99 and not 101. Getting this wrong drops
    // or duplicates a byte at every seek.
    const res = await get("bytes=0-99");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 0-99/${SIZE}`);
    assert.equal(res.headers.get("content-length"), "100");
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(0, 100));
  });

  test("a range in the middle returns the right slice", async () => {
    const res = await get("bytes=250-499");

    assert.equal(res.headers.get("content-range"), `bytes 250-499/${SIZE}`);
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(250, 500));
  });

  test("a single byte is a valid range", async () => {
    const res = await get("bytes=42-42");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-length"), "1");
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(42, 43));
  });

  test("the last byte is reachable", async () => {
    const res = await get(`bytes=${SIZE - 1}-${SIZE - 1}`);

    assert.equal(res.status, 206);
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(SIZE - 1));
  });

  test("an end past the file is clamped rather than refused", async () => {
    // Players routinely ask for more than is there. Answering 416 would stop
    // playback at the last chunk of every clip.
    const res = await get("bytes=900-99999");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 900-${SIZE - 1}/${SIZE}`);
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(900));
  });
});

describe("an open-ended range", () => {
  test("`bytes=500-` runs to the end of the file", async () => {
    const res = await get("bytes=500-");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 500-${SIZE - 1}/${SIZE}`);
    assert.equal(res.headers.get("content-length"), String(SIZE - 500));
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(500));
  });

  test("`bytes=0-` is the whole file, as a 206", async () => {
    const res = await get("bytes=0-");

    assert.equal(res.status, 206);
    assert.deepEqual(await bytesOf(res), CONTENT);
  });
});

describe("a suffix range", () => {
  test("`bytes=-500` is the LAST 500 bytes, not the first", async () => {
    // The branch a reader skims past. Reading it as "0 to 500" serves the
    // wrong half of the clip on a seek to the end.
    const res = await get("bytes=-500");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 500-${SIZE - 1}/${SIZE}`);
    assert.equal(res.headers.get("content-length"), "500");
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(500));
  });

  test("a suffix longer than the file is clamped to the whole file", async () => {
    const res = await get("bytes=-99999");

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 0-${SIZE - 1}/${SIZE}`);
    assert.deepEqual(await bytesOf(res), CONTENT);
  });

  test("a one-byte suffix is the final byte", async () => {
    const res = await get("bytes=-1");

    assert.equal(res.headers.get("content-range"), `bytes ${SIZE - 1}-${SIZE - 1}/${SIZE}`);
    assert.deepEqual(await bytesOf(res), CONTENT.subarray(SIZE - 1));
  });
});

describe("an unsatisfiable range", () => {
  test("a start past the end is 416, with the file's size", async () => {
    // A 200 here makes a player loop the first chunk for ever, because it
    // never learns that it asked for something impossible.
    const res = await get(`bytes=${SIZE}-`);

    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), `bytes */${SIZE}`);
    await res.arrayBuffer();
  });

  test("a start after the end is 416", async () => {
    const res = await get("bytes=500-100");
    assert.equal(res.status, 416);
    await res.arrayBuffer();
  });

  test("a range far past the file is 416", async () => {
    const res = await get("bytes=99999-100000");
    assert.equal(res.status, 416);
    await res.arrayBuffer();
  });
});

describe("a malformed range", () => {
  test("is ignored, and the whole file is served", async () => {
    // Per RFC 9110: an unparseable Range is ignored, not an error. Answering
    // 416 to a header a proxy mangled would break playback entirely.
    for (const range of ["bytes=abc", "items=0-10", "bytes=", "nonsense", "bytes=1-2, 5-6"]) {
      const res = await get(range);
      assert.equal(res.status, 200, `${range} was not ignored`);
      assert.equal((await bytesOf(res)).length, SIZE);
    }
  });
});

describe("missing files", () => {
  test("a file that is not there is a 404 as JSON", async () => {
    const res = await get(undefined, "/missing");

    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Not found" });
  });

  test("a directory is a 404, not a stream of something", async () => {
    const res = await get(undefined, "/dir");

    assert.equal(res.status, 404);
    await res.text();
  });

  test("a range request for a missing file is a 404, not a 416", async () => {
    const res = await get("bytes=0-99", "/missing");
    assert.equal(res.status, 404);
    await res.text();
  });
});
