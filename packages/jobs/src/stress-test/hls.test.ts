/**
 * The playlist resolution these tests cover was wrong in two ways for months,
 * because the whole harness was unreachable and nothing exercised it. Both
 * failure modes are asserted directly rather than through the ramp.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isMasterPlaylist, resolveSegmentUrls, resolveVariantUrl } from "./hls.ts";

const BASE = "http://plex.local:32400/video/:/transcode/universal/start.m3u8";

describe("isMasterPlaylist", () => {
  test("recognises a master playlist by its variant tag", () => {
    assert.equal(isMasterPlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n"), true);
  });

  test("does not mistake a media playlist for one", () => {
    assert.equal(isMasterPlaylist("#EXTM3U\n#EXTINF:5.0,\n00000.ts\n"), false);
  });
});

describe("resolveVariantUrl", () => {
  test("passes an absolute variant URL through unchanged", () => {
    // Real Plex emits absolute URLs here. Joining one onto the transcode path
    // produced `/video/:/transcode/universal/http://…`, which 404s.
    const m3u8 =
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\nhttp://plex.local:32400/video/:/transcode/universal/session/abc/base/index.m3u8?session=abc\n";
    assert.equal(
      resolveVariantUrl(m3u8, BASE),
      "http://plex.local:32400/video/:/transcode/universal/session/abc/base/index.m3u8?session=abc",
    );
  });

  test("resolves a relative variant URL against the playlist's directory", () => {
    const m3u8 = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\nsession/abc/base/index.m3u8\n";
    assert.equal(
      resolveVariantUrl(m3u8, BASE),
      "http://plex.local:32400/video/:/transcode/universal/session/abc/base/index.m3u8",
    );
  });

  test("resolves a root-relative variant URL against the origin", () => {
    const m3u8 = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/other/path/index.m3u8\n";
    assert.equal(resolveVariantUrl(m3u8, BASE), "http://plex.local:32400/other/path/index.m3u8");
  });

  test("ignores blank lines and comments between the tag and the URL list", () => {
    const m3u8 = "#EXTM3U\n\n#EXT-X-STREAM-INF:BANDWIDTH=1\n\nsession/a/index.m3u8\n";
    assert.equal(
      resolveVariantUrl(m3u8, BASE),
      "http://plex.local:32400/video/:/transcode/universal/session/a/index.m3u8",
    );
  });

  test("throws rather than inventing a URL when there is no variant", () => {
    assert.throws(() => resolveVariantUrl("#EXTM3U\n#EXTINF:5.0,\n00000.ts\n", BASE), /no variant/i);
  });
});

describe("resolveSegmentUrls", () => {
  // The original derived the base with `lastIndexOf("/")` over the raw URL, so
  // any `/` inside the query string produced a base that was part query.
  test("resolves relative segments against a playlist URL carrying a query string", () => {
    const playlist =
      "http://plex.local:32400/video/:/transcode/universal/session/abc/base/index.m3u8?session=abc&path=/library/metadata/17";
    const segments = resolveSegmentUrls("#EXTM3U\n#EXTINF:5.0,\n00000.ts\n#EXTINF:5.0,\n00001.ts\n", playlist);
    assert.deepEqual(segments, [
      "http://plex.local:32400/video/:/transcode/universal/session/abc/base/00000.ts",
      "http://plex.local:32400/video/:/transcode/universal/session/abc/base/00001.ts",
    ]);
  });

  test("leaves absolute and root-relative segment URLs alone", () => {
    const playlist = "http://plex.local:32400/a/b/index.m3u8";
    const segments = resolveSegmentUrls("#EXTM3U\nhttp://cdn.example/x.ts\n/root/y.ts\n", playlist);
    assert.deepEqual(segments, ["http://cdn.example/x.ts", "http://plex.local:32400/root/y.ts"]);
  });

  test("drops tag lines", () => {
    const segments = resolveSegmentUrls(
      "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5.0,\n00000.ts\n",
      "http://p/x/i.m3u8",
    );
    assert.deepEqual(segments, ["http://p/x/00000.ts"]);
  });
});
