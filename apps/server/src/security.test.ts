import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPlexImageUrl, isBuildAsset, parseCookieHeader, resolvePrerollId, resolveStaticPath } from "./security.ts";

const DIST = "/srv/web/dist";

describe("resolveStaticPath", () => {
  test("returns null for traversal attempts", () => {
    assert.equal(resolveStaticPath(DIST, "/../../etc/passwd"), null);
    assert.equal(resolveStaticPath(DIST, "/../../../etc/hostname"), null);
    assert.equal(resolveStaticPath(DIST, "/foo/../../etc/passwd"), null);
  });

  test("rejects URL-encoded traversal", () => {
    assert.equal(resolveStaticPath(DIST, "/%2e%2e/%2e%2e/etc/hostname"), null);
    assert.equal(resolveStaticPath(DIST, "/foo/%2E%2E/%2E%2E/etc/passwd"), null);
  });

  test("/ resolves to index.html in dist", () => {
    assert.equal(resolveStaticPath(DIST, "/"), `${DIST}/index.html`);
  });

  test("normal SPA paths resolve under dist", () => {
    assert.equal(resolveStaticPath(DIST, "/index.html"), `${DIST}/index.html`);
    assert.equal(resolveStaticPath(DIST, "/assets/app.js"), `${DIST}/assets/app.js`);
    assert.equal(resolveStaticPath(DIST, "/rules/123"), `${DIST}/rules/123`);
  });

  test("trailing slash and dot segments inside dist still resolve to dist", () => {
    assert.equal(resolveStaticPath(DIST, "/foo/./bar"), `${DIST}/foo/bar`);
  });
});

describe("isBuildAsset", () => {
  test("hashed chunks and stylesheets are assets", () => {
    assert.equal(isBuildAsset("/assets/SettingsPrerolls-BhC939To.js"), true);
    assert.equal(isBuildAsset("/assets/index-BCjxB70r.css"), true);
  });

  test("app routes are not, however deep", () => {
    assert.equal(isBuildAsset("/"), false);
    assert.equal(isBuildAsset("/settings/prerolls"), false);
    assert.equal(isBuildAsset("/rules/123"), false);
  });

  test("does not match a route that merely mentions assets", () => {
    // These must still reach the SPA fallback, or deep-linking to them 404s.
    assert.equal(isBuildAsset("/assets"), false);
    assert.equal(isBuildAsset("/library/assets/42"), false);
  });
});

describe("resolvePrerollId", () => {
  const VALID = "3f2a1c4e-9b8d-4e7a-a1b2-c3d4e5f60718";

  test("accepts a canonical UUID and lower-cases it", () => {
    assert.equal(resolvePrerollId(VALID), VALID);
    assert.equal(resolvePrerollId(VALID.toUpperCase()), VALID);
  });

  test("rejects traversal in every encoding", () => {
    assert.equal(resolvePrerollId("../../etc/passwd"), null);
    assert.equal(resolvePrerollId("%2e%2e%2f%2e%2e%2fetc%2fpasswd"), null);
    assert.equal(resolvePrerollId(`${VALID}/../../../etc/passwd`), null);
    assert.equal(resolvePrerollId("/etc/passwd"), null);
  });

  test("rejects anything that isn't exactly a UUID", () => {
    assert.equal(resolvePrerollId(""), null);
    assert.equal(resolvePrerollId(null), null);
    assert.equal(resolvePrerollId(undefined), null);
    assert.equal(resolvePrerollId(`${VALID}.mp4`), null);
    assert.equal(resolvePrerollId(`  ${VALID}`), null);
    assert.equal(resolvePrerollId(VALID.replace(/-/g, "")), null);
  });

  test("rejects malformed percent-encoding rather than throwing", () => {
    assert.equal(resolvePrerollId("%E0%A4%A"), null);
  });
});

describe("buildPlexImageUrl", () => {
  const plexUrl = "http://plex.local:32400";
  const plexToken = "tk-secret";

  test("returns null when path is missing or blank", () => {
    assert.equal(buildPlexImageUrl({ thumbPath: null, plexUrl, plexToken }), null);
    assert.equal(buildPlexImageUrl({ thumbPath: "", plexUrl, plexToken }), null);
  });

  test("returns null when path doesn't start with /", () => {
    assert.equal(buildPlexImageUrl({ thumbPath: "thumb/123", plexUrl, plexToken }), null);
  });

  test("rejects protocol-relative URLs that would be served from another host", () => {
    assert.equal(buildPlexImageUrl({ thumbPath: "//evil.com/x", plexUrl, plexToken }), null);
  });

  test("rejects absolute URLs", () => {
    assert.equal(buildPlexImageUrl({ thumbPath: "/foo://evil.com/x", plexUrl, plexToken }), null);
  });

  test("rejects backslash-prefixed paths", () => {
    assert.equal(buildPlexImageUrl({ thumbPath: "/\\evil.com/x", plexUrl, plexToken }), null);
  });

  test("returns null when plex config is missing", () => {
    assert.equal(
      buildPlexImageUrl({ thumbPath: "/library/metadata/123/thumb/456", plexUrl: undefined, plexToken }),
      null,
    );
    assert.equal(
      buildPlexImageUrl({ thumbPath: "/library/metadata/123/thumb/456", plexUrl, plexToken: undefined }),
      null,
    );
  });

  test("attaches the token and resolves to the configured Plex origin for valid paths", () => {
    const url = buildPlexImageUrl({ thumbPath: "/library/metadata/123/thumb/456", plexUrl, plexToken });
    assert.ok(url);
    assert.equal(url.origin, "http://plex.local:32400");
    assert.equal(url.pathname, "/library/metadata/123/thumb/456");
    assert.equal(url.searchParams.get("X-Plex-Token"), "tk-secret");
  });

  test("a path that resolves outside the configured origin is rejected", () => {
    // Theoretically `new URL` would resolve same-origin since thumbPath
    // starts with `/`, but if someone tries a host-relative trick it must
    // still be rejected by the origin check.
    const url = buildPlexImageUrl({ thumbPath: "/foo", plexUrl: "http://plex.local:32400", plexToken });
    assert.ok(url);
    assert.equal(url.origin, "http://plex.local:32400");
  });
});

describe("parseCookieHeader", () => {
  test("finds the named cookie wherever it sits in the header", () => {
    assert.equal(parseCookieHeader("a=1; tb_admin_session=tok; b=2", "tb_admin_session"), "tok");
    assert.equal(parseCookieHeader("tb_admin_session=tok", "tb_admin_session"), "tok");
  });

  test("a name that merely ends with the one asked for is not a match", () => {
    assert.equal(parseCookieHeader("nottb_admin_session=tok", "tb_admin_session"), undefined);
  });

  test("returns undefined for an absent cookie or an empty header", () => {
    assert.equal(parseCookieHeader("a=1", "tb_admin_session"), undefined);
    assert.equal(parseCookieHeader("", "tb_admin_session"), undefined);
  });

  test("ignores malformed segments rather than throwing", () => {
    assert.equal(parseCookieHeader("garbage; tb_admin_session=tok", "tb_admin_session"), "tok");
  });
});
