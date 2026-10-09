import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "./platform.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";

test("phones are recognised by their user agent", () => {
  assert.equal(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5 }), "ios");
  assert.equal(detectPlatform({ userAgent: PIXEL, maxTouchPoints: 5 }), "android");
});

test("an iPad pretending to be a Mac is still iOS; a real Mac is desktop", () => {
  assert.equal(detectPlatform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5 }), "ios");
  assert.equal(detectPlatform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0 }), "desktop");
});

test("?platform= forces a look, and only to a known one", () => {
  assert.equal(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5, search: "?platform=android" }), "android");
  assert.equal(detectPlatform({ userAgent: PIXEL, maxTouchPoints: 5, search: "?platform=windows" }), "android");
});
