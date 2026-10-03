import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_PREROLL_DEFAULTS,
  portalPrerollCardInput,
  portalPrerollCardSchema,
  resolvePortalPrerollCard,
} from "./portal-preroll.ts";

const VALID = { ...resolvePortalPrerollCard(undefined), url: "https://portal.example.com" };

describe("resolvePortalPrerollCard", () => {
  it("fills every gap from the defaults", () => {
    assert.deepEqual(resolvePortalPrerollCard(undefined), { url: "", ...PORTAL_PREROLL_DEFAULTS });
  });

  it("keeps a deliberately empty message rather than restoring the default", () => {
    assert.equal(resolvePortalPrerollCard({ message: "" }).message, "");
    assert.equal(resolvePortalPrerollCard({ headline: "" }).headline, PORTAL_PREROLL_DEFAULTS.headline);
  });
});

describe("the stored schema", () => {
  it("accepts a row the strict schema would reject, so one bad row can't break config reads", () => {
    assert.equal(portalPrerollCardSchema.safeParse({ accent: "red", durationSeconds: 999 }).success, true);
  });
});

describe("portalPrerollCardInput", () => {
  it("accepts a complete card and a blank address", () => {
    assert.equal(portalPrerollCardInput.safeParse(VALID).success, true);
    assert.equal(portalPrerollCardInput.safeParse({ ...VALID, url: "" }).success, true);
  });

  for (const [field, value] of [
    ["accent", "orange"],
    ["background", "#fff"],
    ["url", "portal.example.com"],
    ["url", "javascript:alert(1)"],
    ["durationSeconds", 2],
    ["durationSeconds", 31],
    ["headline", ""],
  ] as const) {
    it(`rejects ${field} = ${JSON.stringify(value)}`, () => {
      assert.equal(portalPrerollCardInput.safeParse({ ...VALID, [field]: value }).success, false);
    });
  }
});
