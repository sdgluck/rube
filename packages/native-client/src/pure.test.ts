import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiUrl, authHeaders, mediaUrl, setConnection } from "./connection.ts";
import { connectLink, isInAppPath, parseDeepLink } from "./deep-links.ts";
import { compareVersions, judgeServerInfo, MIN_SERVER_VERSION, serverCandidates } from "./server-url.ts";

afterEach(() => setConnection(null));

describe("connection", () => {
  test("in a browser every URL stays relative and no header is added", () => {
    // The browser build must make exactly the requests it always made.
    assert.equal(apiUrl("/api/trpc"), "/api/trpc");
    assert.equal(mediaUrl("/api/plex-image?path=/x"), "/api/plex-image?path=/x");
    assert.deepEqual(authHeaders(), {});
  });

  test("in the app URLs are absolute and the session is a bearer header", () => {
    setConnection({ server: "https://tb.example", token: "abc", mediaToken: null });
    assert.equal(apiUrl("/api/trpc"), "https://tb.example/api/trpc");
    assert.deepEqual(authHeaders(), { Authorization: "Bearer abc" });
  });

  test("media URLs carry the media token, never the session", () => {
    setConnection({ server: "https://tb.example", token: "session", mediaToken: "m&t" });
    assert.equal(mediaUrl("/api/plex-image?path=/x"), "https://tb.example/api/plex-image?path=/x&access_token=m%26t");
    assert.equal(mediaUrl("/api/prerolls/1/thumb"), "https://tb.example/api/prerolls/1/thumb?access_token=m%26t");
    assert.ok(!mediaUrl("/x").includes("session"));
  });
});

describe("serverCandidates", () => {
  test("tries https then http when no scheme was typed", () => {
    assert.deepEqual(serverCandidates(" 192.168.1.10:3000 "), [
      "https://192.168.1.10:3000",
      "http://192.168.1.10:3000",
    ]);
  });

  test("keeps an explicit scheme and drops the path", () => {
    assert.deepEqual(serverCandidates("http://tb.lan:3000/settings/api"), ["http://tb.lan:3000"]);
  });

  test("refuses anything that isn't http(s)", () => {
    assert.deepEqual(serverCandidates("javascript:alert(1)"), []);
    assert.deepEqual(serverCandidates("ftp://tb.lan"), []);
    assert.deepEqual(serverCandidates(""), []);
  });
});

describe("judgeServerInfo", () => {
  const info = (product: string, version: string) => ({ result: { data: { product, version } } });

  test("accepts the right app at a supported version", () => {
    assert.deepEqual(judgeServerInfo("https://x", info("tinkerbell-admin", MIN_SERVER_VERSION), "tinkerbell-admin"), {
      ok: true,
      server: "https://x",
      version: MIN_SERVER_VERSION,
    });
  });

  test("says when the portal address was given to the admin app", () => {
    const res = judgeServerInfo("https://x", info("tinkerbell-portal", "9.0.0"), "tinkerbell-admin");
    assert.equal(res.ok === false && res.reason, "wrong-app");
  });

  test("refuses a server older than the bundled UI supports", () => {
    const res = judgeServerInfo("https://x", info("tinkerbell-admin", "0.1.0"), "tinkerbell-admin");
    assert.equal(res.ok === false && res.reason, "too-old");
  });

  test("anything else isn't Tinkerbell", () => {
    const res = judgeServerInfo("https://x", { hello: "world" }, "tinkerbell-admin");
    assert.equal(res.ok === false && res.reason, "not-tinkerbell");
  });

  test("compareVersions is numeric, not lexical", () => {
    assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
    assert.equal(compareVersions("1.0.0-beta", "1.0.0"), 0);
    assert.equal(compareVersions("0.35.0", "0.36.0"), -1);
  });
});

describe("deep links", () => {
  test("connect carries the server for the picker to confirm", () => {
    const link = connectLink("tinkerbell", "http://192.168.1.10:3000");
    assert.deepEqual(parseDeepLink(link, "tinkerbell"), { kind: "connect", server: "http://192.168.1.10:3000" });
  });

  test("open accepts an in-app path with its query", () => {
    assert.deepEqual(parseDeepLink("tinkerbell://open/rules/42?tab=history", "tinkerbell"), {
      kind: "open",
      path: "/rules/42?tab=history",
    });
  });

  test("another app's scheme is ignored", () => {
    assert.equal(parseDeepLink("tinkerbell-portal://open/rules", "tinkerbell"), null);
  });

  test("open refuses anything that could leave the app", () => {
    for (const raw of [
      "tinkerbell://open//evil.example",
      "tinkerbell://open/javascript:alert(1)",
      "tinkerbell://nope/rules",
    ]) {
      assert.equal(parseDeepLink(raw, "tinkerbell"), null, raw);
    }
    assert.equal(isInAppPath("https://evil.example"), false);
    assert.equal(isInAppPath("/rules/../../x"), false);
    // The URL parser collapses dot segments itself, so this lands inside the app.
    assert.deepEqual(parseDeepLink("tinkerbell://open/../../etc", "tinkerbell"), { kind: "open", path: "/etc" });
  });
});
