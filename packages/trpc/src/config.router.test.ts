import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl } from "./config.router.ts";

describe("isHttpUrl", () => {
  it("accepts absolute http and https addresses", () => {
    assert.equal(isHttpUrl("https://portal.example.com"), true);
    assert.equal(isHttpUrl("http://192.168.1.10:3100/"), true);
  });

  it("rejects what Plex couldn't redirect a sign-in to", () => {
    assert.equal(isHttpUrl("portal.example.com"), false);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("ftp://example.com"), false);
    assert.equal(isHttpUrl(""), false);
  });
});
