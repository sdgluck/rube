/**
 * The SSRF guard had no tests, and could not usefully have had any: it
 * short-circuits when `NODE_ENV !== "production"`, so under `node --test` —
 * where `NODE_ENV` is unset — `assertSafeOutboundUrl` returns without checking
 * anything. Every assertion below would have passed against an empty function.
 *
 * So each test sets `NODE_ENV=production` around the call. That is the point of
 * the file: the guard is only ever *live* in production, which means production
 * is the only configuration worth asserting, and it is the one nothing
 * exercised.
 *
 * What this protects: `domains/prerolls`' ingest and six senders in
 * `domains/notifications` fetch URLs an admin typed into Settings. The server
 * binds loopback-only by default, so the practical exposure is small today —
 * but "small today" is a property of the bind, not of this function, and the
 * bind is not what a future unauthenticated route would change.
 *
 * Several cases below are marked as *documenting current behaviour* rather than
 * blessing it. `isPrivateHost` matches on the literal hostname string, so any
 * encoding of an address that `URL` does not normalise — and any name that only
 * resolves to a private address at connect time — is out of its reach. Node's
 * `URL` does normalise decimal and hex IPv4, which covers the classic cases;
 * DNS rebinding is not addressable without resolving the host, which this
 * deliberately does not do.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { assertSafeOutboundUrl, UnsafeUrlError } from "./ssrf.ts";

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = "production";
  delete process.env.TINKERBELL_ALLOW_PRIVATE_OUTBOUND;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

/** Asserts the URL is refused, and that it is refused as an `UnsafeUrlError`. */
function refuses(url: string, why: RegExp): void {
  assert.throws(
    () => assertSafeOutboundUrl(url),
    (err: unknown) => {
      assert.ok(err instanceof UnsafeUrlError, `expected UnsafeUrlError for ${url}, got ${String(err)}`);
      assert.match(err.message, why);
      return true;
    },
    `${url} was allowed`,
  );
}

function allows(url: string): void {
  assert.doesNotThrow(() => assertSafeOutboundUrl(url), `${url} was refused`);
}

describe("protocol", () => {
  test("http and https are the only schemes allowed", () => {
    allows("http://example.com/hook");
    allows("https://example.com/hook");
  });

  test("file, ftp, gopher and data are refused", () => {
    // `gopher://` and `file://` are the classic SSRF pivots; `data:` would let
    // a webhook "fetch" attacker-authored bytes without a network hop at all.
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com:70/x",
      "data:text/plain,hi",
    ]) {
      refuses(url, /Disallowed protocol/);
    }
  });

  test("the check is on the scheme, not on the host", () => {
    // A public host over a disallowed scheme is still refused.
    refuses("ftp://example.com/x", /Disallowed protocol/);
  });
});

describe("malformed input", () => {
  test("something that isn't a URL is refused rather than thrown through", () => {
    // The caller is handing us admin-typed config. A `TypeError` escaping from
    // `new URL` would surface as a 500 rather than as "that isn't a URL".
    for (const url of ["", "not a url", "http://", "://example.com"]) {
      refuses(url, /Not a valid URL/);
    }
  });

  test("a pre-parsed URL object is accepted", () => {
    assert.doesNotThrow(() => assertSafeOutboundUrl(new URL("https://example.com")));
    assert.throws(() => assertSafeOutboundUrl(new URL("http://127.0.0.1")), UnsafeUrlError);
  });
});

describe("private and loopback addresses", () => {
  test("loopback is refused, in each of its spellings", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "[::1]"]) {
      refuses(`http://${host}/x`, /private\/loopback/);
    }
  });

  test("the unspecified address is refused", () => {
    refuses("http://0.0.0.0/x", /private\/loopback/);
  });

  test("every RFC1918 range is refused", () => {
    for (const host of [
      "10.0.0.1",
      "10.255.255.254",
      "192.168.0.1",
      "192.168.255.254",
      "172.16.0.1",
      "172.31.255.254",
    ]) {
      refuses(`http://${host}/x`, /private\/loopback/);
    }
  });

  test("the 172.16/12 boundary is not over-wide", () => {
    // 172.15 and 172.32 are public. A regex written as `172\.\d+` would eat
    // both, and a `172\.(1[6-9]|2\d|3[01])` that dropped the anchor would eat
    // 172.320. Both directions are worth pinning.
    allows("http://172.15.0.1/x");
    allows("http://172.32.0.1/x");
    refuses("http://172.16.0.1/x", /private\/loopback/);
    refuses("http://172.31.0.1/x", /private\/loopback/);
  });

  test("link-local is refused — this is the cloud metadata endpoint", () => {
    // 169.254.169.254 is the single most valuable SSRF target on a cloud host.
    refuses("http://169.254.169.254/latest/meta-data/", /private\/loopback/);
    refuses("http://169.254.0.1/x", /private\/loopback/);
  });

  test("IPv6 link-local and unique-local are refused", () => {
    for (const host of ["[fe80::1]", "[FE80::1]", "[fc00::1]", "[fd12::1]", "[fdff::1]"]) {
      refuses(`http://${host}/x`, /private\/loopback/);
    }
  });

  test("a public address is allowed", () => {
    for (const host of ["example.com", "1.1.1.1", "8.8.8.8", "[2606:4700:4700::1111]", "172.15.1.1"]) {
      allows(`http://${host}/x`);
    }
  });
});

describe("alternative encodings of a private address", () => {
  test("decimal and hex IPv4 are normalised by URL, so they are caught", () => {
    // 2130706433 === 0x7f000001 === 127.0.0.1. Node's URL parser rewrites the
    // host to dotted-quad before `isPrivateHost` sees it, which is the only
    // reason a string-matching guard catches these at all.
    assert.equal(new URL("http://2130706433/").hostname, "127.0.0.1");
    refuses("http://2130706433/x", /private\/loopback/);
    refuses("http://0x7f000001/x", /private\/loopback/);
    refuses("http://0177.0.0.1/x", /private\/loopback/);
  });

  test("userinfo cannot be used to disguise the host", () => {
    // `http://example.com@127.0.0.1/` has host 127.0.0.1, not example.com.
    assert.equal(new URL("http://example.com@127.0.0.1/").hostname, "127.0.0.1");
    refuses("http://example.com@127.0.0.1/x", /private\/loopback/);
  });

  test("a port does not change the verdict", () => {
    refuses("http://127.0.0.1:8080/x", /private\/loopback/);
    allows("https://example.com:8443/x");
  });

  test("a trailing-dot address is refused", () => {
    // `127.0.0.1.` is a valid absolute name for loopback. `URL` happens to
    // strip the dot from a dotted-quad, but it keeps it on a name, so the guard
    // strips one itself rather than relying on that.
    refuses("http://127.0.0.1./x", /private\/loopback/);
    refuses("http://localhost./x", /private\/loopback/);
  });

  test("an IPv4-mapped IPv6 literal is refused, in both spellings", () => {
    // This one was a real hole. `URL` rewrites `[::ffff:127.0.0.1]` to
    // `[::ffff:7f00:1]`, which matched none of the private patterns — so the
    // most obvious loopback address in IPv6 clothing went straight through.
    assert.equal(new URL("http://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");
    refuses("http://[::ffff:127.0.0.1]/x", /private\/loopback/);
    refuses("http://[::ffff:7f00:1]/x", /private\/loopback/);
    refuses("http://[::ffff:10.0.0.1]/x", /private\/loopback/);
    refuses("http://[::ffff:a00:1]/x", /private\/loopback/);
    refuses("http://[::ffff:169.254.169.254]/x", /private\/loopback/);
  });

  test("a mapped *public* address is still allowed", () => {
    // The unmapping must not turn into a blanket ban on IPv4-mapped addresses.
    allows("http://[::ffff:1.1.1.1]/x");
  });

  test("the IPv6 unspecified address is refused", () => {
    refuses("http://[::]/x", /private\/loopback/);
  });

  test("KNOWN GAP: a name that resolves to a private address is allowed", () => {
    // Not fixable here — this function deliberately does not resolve DNS, so
    // rebinding and private-pointing names are out of scope by construction.
    // Closing it means resolving the host and checking the answer, and then
    // pinning the connection to that answer; a check-then-connect without the
    // pin is defeated by a second lookup returning something else.
    allows("http://localtest.me/x");
  });
});

describe("the opt-outs", () => {
  test("`allowPrivate` lets a caller reach a LAN service deliberately", () => {
    // This is how a Plex or *Arr URL on RFC1918 is meant to be reached.
    assert.doesNotThrow(() => assertSafeOutboundUrl("http://192.168.1.50:32400", { allowPrivate: true }));
  });

  test("`allowPrivate` does not relax the protocol check", () => {
    // The flag is about address ranges. A `file://` URL is not a LAN service.
    assert.throws(() => assertSafeOutboundUrl("file:///etc/passwd", { allowPrivate: true }), UnsafeUrlError);
  });

  test("TINKERBELL_ALLOW_PRIVATE_OUTBOUND=1 switches the guard off globally", () => {
    process.env.TINKERBELL_ALLOW_PRIVATE_OUTBOUND = "1";
    allows("http://169.254.169.254/latest/meta-data/");
  });

  test("only the exact value 1 opts in", () => {
    // A truthy-string check would make `=0` and `=false` enable it, which is
    // the opposite of what an operator typing either of those intends.
    for (const value of ["0", "false", "", "true", "yes"]) {
      process.env.TINKERBELL_ALLOW_PRIVATE_OUTBOUND = value;
      refuses("http://127.0.0.1/x", /private\/loopback/);
    }
  });

  test("outside production the guard is off entirely", () => {
    // The documented behaviour, asserted so that turning it on everywhere is a
    // deliberate change with a failing test behind it rather than a surprise
    // for someone running a LAN Plex in dev.
    process.env.NODE_ENV = "development";
    allows("http://127.0.0.1/x");
    allows("http://169.254.169.254/x");

    delete process.env.NODE_ENV;
    allows("http://127.0.0.1/x");
  });
});
