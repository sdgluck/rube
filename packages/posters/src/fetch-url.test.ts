/**
 * A `posterUrl` can arrive from a registry pack — third-party content this
 * server will fetch on a schedule and hand to a native image decoder. These
 * tests are the gate, so they are written as "what must be refused" rather
 * than "what works".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { POSTER_MAX_BYTES } from "@tinkerbell/contracts";
import { fetchPosterUrl } from "./fetch-url.ts";

const OK_URL = "https://raw.githubusercontent.com/pack/poster.jpg";

function respond(body: Uint8Array, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(body as BodyInit, {
      status: 200,
      headers: { "content-type": "image/jpeg", ...headers },
    })) as unknown as typeof fetch;
}

async function jpegBytes(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 30, channels: 3, background: "#123456" } })
    .jpeg()
    .toBuffer();
}

describe("fetchPosterUrl", () => {
  it("accepts a real image from an allow-listed HTTPS host", async () => {
    const result = await fetchPosterUrl(OK_URL, respond(await jpegBytes()));
    assert.equal(result.status, "ok");
  });

  it("refuses a non-HTTPS URL without making a request", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;
    const result = await fetchPosterUrl("http://raw.githubusercontent.com/x.jpg", fetchImpl);
    assert.equal(result.status, "rejected");
    assert.equal(called, false, "must not fetch a URL it has already refused");
  });

  it("refuses a host that isn't on the allow-list", async () => {
    const result = await fetchPosterUrl("https://example.com/x.jpg", respond(await jpegBytes()));
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /hosted on/i);
  });

  it("refuses a response that declares itself oversized", async () => {
    const result = await fetchPosterUrl(
      OK_URL,
      respond(await jpegBytes(), { "content-length": String(POSTER_MAX_BYTES + 1) }),
    );
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /cap/);
  });

  it("refuses a response that lies about its size, before the decoder sees it", async () => {
    // No content-length at all, and a body past the cap: the streaming guard
    // is the one that has to catch this.
    const oversized = new Uint8Array(POSTER_MAX_BYTES + 1024);
    const result = await fetchPosterUrl(OK_URL, respond(oversized));
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /cap/);
  });

  it("refuses HTML wearing an image content-type", async () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    const result = await fetchPosterUrl(OK_URL, respond(html));
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /not a supported image|did not decode/i);
  });

  it("reports its own content type from the decoder, not from the response", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const result = await fetchPosterUrl(OK_URL, respond(png, { "content-type": "text/html" }));
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" ? result.contentType : "", "image/png");
  });

  it("surfaces an upstream failure as a rejection rather than a throw", async () => {
    const failing = (async () => new Response(null, { status: 503, statusText: "Service Unavailable" })) as never;
    const result = await fetchPosterUrl(OK_URL, failing);
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /503/);
  });

  it("surfaces a network error as a rejection rather than a throw", async () => {
    const throwing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as never;
    const result = await fetchPosterUrl(OK_URL, throwing);
    assert.equal(result.status, "rejected");
    assert.match(result.status === "rejected" ? result.reason : "", /ECONNREFUSED/);
  });
});
