import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { COOKIE_NAMES, clearSessionCookie, isSecureRequest, parseCookie, setSessionCookie } from "./cookies.ts";

describe("parseCookie", () => {
  test("finds a cookie among others", () => {
    assert.equal(parseCookie("a=1; tb_admin_session=abc; b=2", "tb_admin_session"), "abc");
  });

  test("doesn't match a name that merely ends with the one asked for", () => {
    assert.equal(parseCookie("xtb_admin_session=abc", "tb_admin_session"), undefined);
  });

  test("decodes percent-encoded values", () => {
    assert.equal(parseCookie("k=a%20b", "k"), "a b");
  });
});

describe("isSecureRequest", () => {
  test("true for an https origin", () => {
    assert.equal(isSecureRequest(new Request("https://example.com/api/trpc")), true);
  });

  test("false on plain http with no proxy header — LAN installs must still work", () => {
    assert.equal(isSecureRequest(new Request("http://192.168.1.10:3000/api/trpc")), false);
  });

  test("true behind a proxy that terminated TLS", () => {
    const req = new Request("http://internal:3000/api/trpc", { headers: { "x-forwarded-proto": "https" } });
    assert.equal(isSecureRequest(req), true);
  });

  test("reads only the first hop of a multi-proxy header", () => {
    const req = new Request("http://internal:3000/api/trpc", { headers: { "x-forwarded-proto": "https, http" } });
    assert.equal(isSecureRequest(req), true);
  });
});

describe("session cookies", () => {
  test("the two apps use different names — cookies aren't port-scoped", () => {
    assert.notEqual(COOKIE_NAMES.admin, COOKIE_NAMES.portal);
  });

  test("Secure is set over https and omitted otherwise", () => {
    const secure = new Headers();
    setSessionCookie(secure, "tok", { scope: "admin", secure: true });
    assert.match(secure.get("set-cookie")!, /; Secure/);

    const plain = new Headers();
    setSessionCookie(plain, "tok", { scope: "admin", secure: false });
    assert.doesNotMatch(plain.get("set-cookie")!, /Secure/);
  });

  test("the cookie is HttpOnly and SameSite=Lax", () => {
    const headers = new Headers();
    setSessionCookie(headers, "tok", { scope: "admin", secure: false });
    const cookie = headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /^tb_admin_session=tok;/);
  });

  test("an admin cookie expires sooner than a portal one", () => {
    const admin = new Headers();
    setSessionCookie(admin, "tok", { scope: "admin", secure: false });
    const portal = new Headers();
    setSessionCookie(portal, "tok", { scope: "portal", secure: false });

    const maxAge = (h: Headers) => Number(h.get("set-cookie")!.match(/Max-Age=(\d+)/)![1]);
    assert.ok(maxAge(admin) < maxAge(portal));
  });

  test("clearing expires the cookie immediately", () => {
    const headers = new Headers();
    clearSessionCookie(headers, { scope: "admin", secure: false });
    assert.match(headers.get("set-cookie")!, /^tb_admin_session=; .*Max-Age=0/);
  });
});
