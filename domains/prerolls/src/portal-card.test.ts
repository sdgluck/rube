import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { buildPortalCardSvg, CARD_HEIGHT, CARD_WIDTH, displayUrl, renderPortalCardPng } from "./portal-card.ts";

const CONTENT = {
  url: "https://portal.example.com/",
  headline: "Make this Plex yours",
  message: "Sign in with your Plex account to choose what shows up on your home screen.",
  background: "#14161b",
  foreground: "#f2f2f2",
  accent: "#e5a00d",
  showQr: true,
};

describe("displayUrl", () => {
  it("drops the scheme and a bare trailing slash, nothing else", () => {
    assert.equal(displayUrl("https://portal.example.com/"), "portal.example.com");
    assert.equal(displayUrl("http://10.0.0.5:3100"), "10.0.0.5:3100");
    assert.equal(displayUrl("https://example.com/portal/"), "example.com/portal");
  });
});

describe("buildPortalCardSvg", () => {
  it("draws text as paths, so the frame never depends on the host's fonts", () => {
    const svg = buildPortalCardSvg(CONTENT);
    assert.doesNotMatch(svg, /<text/);
    assert.match(svg, new RegExp(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`));
  });

  it("includes the QR plate only when asked", () => {
    assert.match(buildPortalCardSvg(CONTENT), /fill="#ffffff"/);
    assert.doesNotMatch(buildPortalCardSvg({ ...CONTENT, showQr: false }), /fill="#ffffff"/);
  });

  it("is deterministic, so the Settings preview is the frame that gets encoded", () => {
    assert.equal(buildPortalCardSvg(CONTENT), buildPortalCardSvg({ ...CONTENT }));
  });

  it("adds an eyebrow line only when there is one", () => {
    const without = buildPortalCardSvg(CONTENT);
    const withEyebrow = buildPortalCardSvg({ ...CONTENT, eyebrow: "Home Cinema" });
    assert.ok(withEyebrow.length > without.length);
    assert.equal(buildPortalCardSvg({ ...CONTENT, eyebrow: "  " }), without);
  });
});

describe("renderPortalCardPng", () => {
  it("rasterises at full HD", async () => {
    const meta = await sharp(await renderPortalCardPng(CONTENT)).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, CARD_WIDTH);
    assert.equal(meta.height, CARD_HEIGHT);
  });
});
