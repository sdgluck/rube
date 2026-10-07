import { test } from "node:test";
import assert from "node:assert/strict";
import { NATIVE_APPS } from "@tinkerbell/contracts";
import config from "../capacitor.config.ts";

test("the admin app's Capacitor config matches the identity the server allow-lists", () => {
  assert.equal(config.appId, NATIVE_APPS.admin.appId);
  assert.equal(config.server?.hostname, NATIVE_APPS.admin.hostname);
});
